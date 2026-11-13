import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  APIProvider,
  AdvancedMarker,
  Circle,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  LocateFixed,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCatalog } from '../context/CatalogContext';
import { apiFetch, formatINR } from '../lib/api';
import type { Branch, PickupMode, SavedAddress, Vehicle } from '../types';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

export interface SuggestedBranchInfo {
  branchId: string;
  branchName: string;
  cityName: string;
  distanceKm: number;
}

export interface LocationSelection {
  pickupMode: PickupMode;
  pickupBranchId: string;
  returnBranchId: string;
  isOneWay: boolean;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  returnAddress: string;
  returnLat: number;
  returnLng: number;
  serviceable: boolean;
  serviceReason?: string;
  distanceKm?: number;
  deliveryCharge: number;
  oneWayCharge: number;
  suggestedBranch?: SuggestedBranchInfo | null;
}

interface LocationMapPickerProps {
  vehicle: Vehicle;
  branches?: Branch[];
  savedAddresses?: SavedAddress[];
  value: LocationSelection;
  onChange: (next: LocationSelection) => void;
}

function useAutocompleteSuggestions(input: string, biasCenter: { lat: number; lng: number }) {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!placesLib || !input.trim()) {
      setSuggestions([]);
      return;
    }

    const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new AutocompleteSessionToken();
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: input.trim(),
        sessionToken: sessionTokenRef.current!,
        includedRegionCodes: ['in'],
        locationBias: {
          center: biasCenter,
          radius: 40000,
        },
      })
        .then((res) => {
          if (!cancelled) {
            setSuggestions(res.suggestions || []);
          }
        })
        .catch((err: unknown) => {
          console.error('Autocomplete error:', err);
          const msg = String(err);
          if (
            msg.includes('RESOURCE_EXHAUSTED') ||
            msg.includes('OVER_QUERY_LIMIT') ||
            msg.includes('429')
          ) {
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          }
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [placesLib, input, biasCenter.lat, biasCenter.lng]);

  const resetSession = useCallback(() => {
    sessionTokenRef.current = null;
    setSuggestions([]);
  }, []);

  return { suggestions, loading, resetSession, placesLib };
}

const MapPanSync: React.FC<{
  target: { lat: number; lng: number } | null;
  onPanned?: () => void;
}> = ({ target, onPanned }) => {
  const map = useMap();
  useEffect(() => {
    if (map && target) {
      map.panTo(target);
      map.setZoom(14);
      onPanned?.();
    }
  }, [map, target, onPanned]);
  return null;
};

const InnerMapWidget: React.FC<LocationMapPickerProps> = ({
  vehicle,
  branches = [],
  savedAddresses = [],
  value,
  onChange,
}) => {
  const navigate = useNavigate();
  const { settings } = useCatalog();
  const activeBranches = branches.filter((b) => b.active !== false);
  const centralHub =
    branches.find((b) => b.id === (value.pickupBranchId || vehicle.branchId)) ||
    branches.find((b) => b.id === vehicle.branchId) ||
    branches.find((b) => b.id === 'branch-central-hub') ||
    branches[0];

  const isCentralHub = !centralHub || centralHub.id === 'branch-central-hub';
  const hubLat = Number((isCentralHub ? settings?.hubLat : undefined) ?? centralHub?.lat ?? 19.076);
  const hubLng = Number((isCentralHub ? settings?.hubLng : undefined) ?? centralHub?.lng ?? 72.8777);
  const hubRadiusKm = Number((isCentralHub ? settings?.serviceRadiusKm : undefined) ?? centralHub?.deliveryRadiusKm ?? 25);
  const operatingCity = centralHub?.cityName || vehicle.cityName || settings?.operatingCityName || 'Mumbai';
  const hubAddress =
    (isCentralHub ? settings?.businessAddress : undefined) || centralHub?.address || `${operatingCity} Fleet Hub`;
  const hubName = (isCentralHub ? settings?.officeName : undefined) || centralHub?.name || vehicle.branchName || `${operatingCity} Hub`;

  const [activeTab, setActiveTab] = useState<'pickup' | 'return'>('pickup');
  const [sameReturn, setSameReturn] = useState(
    value.returnLat === value.pickupLat && value.returnLng === value.pickupLng
  );
  const [searchText, setSearchText] = useState('');
  const [validating, setValidating] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [fullScreenMobile, setFullScreenMobile] = useState(false);

  const [pendingPoint, setPendingPoint] = useState<{
    lat: number;
    lng: number;
    address: string;
  }>(() => ({
    lat: value.pickupLat || hubLat,
    lng: value.pickupLng || hubLng,
    address: value.pickupAddress || hubAddress,
  }));
  const [panCommand, setPanCommand] = useState<{ lat: number; lng: number } | null>(null);
  const [resolvingPin, setResolvingPin] = useState(false);
  const geocodeTimerRef = useRef<number | null>(null);

  const { suggestions, loading: searchLoading, resetSession, placesLib } =
    useAutocompleteSuggestions(searchText, { lat: hubLat, lng: hubLng });

  const reverseGeocodeCoords = useCallback(async (lat: number, lng: number) => {
    try {
      const geo = await apiFetch<{ formattedAddress: string }>(
        `/api/maps/reverse-geocode?lat=${lat}&lng=${lng}`
      );
      return geo.formattedAddress;
    } catch {
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
  }, []);

  const validateAndSync = useCallback(
    async (draft: LocationSelection) => {
      setValidating(true);
      try {
        const res = await apiFetch<{
          serviceable: boolean;
          reason?: string;
          distanceKm?: number;
          deliveryCharge?: number;
          oneWayCharge?: number;
          branchId?: string;
          suggestedBranch?: SuggestedBranchInfo | null;
        }>('/api/locations/validate', {
          method: 'POST',
          body: JSON.stringify({
            vehicleId: vehicle.id,
            pickupBranchId: draft.pickupBranchId,
            pickupMode: draft.pickupMode,
            pickupLat: draft.pickupLat,
            pickupLng: draft.pickupLng,
            returnLat: draft.returnLat,
            returnLng: draft.returnLng,
          }),
        });

        onChange({
          ...draft,
          pickupBranchId: res.branchId || centralHub?.id || draft.pickupBranchId || 'branch-central-hub',
          returnBranchId: centralHub?.id || draft.returnBranchId || 'branch-central-hub',
          isOneWay: false,
          serviceable: res.serviceable,
          serviceReason: res.reason,
          distanceKm: res.distanceKm,
          deliveryCharge: res.deliveryCharge || 0,
          oneWayCharge: res.oneWayCharge || 0,
          suggestedBranch: res.suggestedBranch || null,
        });
      } catch (err: any) {
        onChange({
          ...draft,
          serviceable: false,
          serviceReason: err.message || 'Unable to verify coverage.',
          suggestedBranch: null,
        });
      } finally {
        setValidating(false);
      }
    },
    [vehicle.id, centralHub?.id, onChange]
  );

  const handleSwitchPinTab = (nextTab: 'pickup' | 'return') => {
    setActiveTab(nextTab);
    if (nextTab === 'pickup') {
      const pt = {
        lat: value.pickupLat || hubLat,
        lng: value.pickupLng || hubLng,
        address: value.pickupAddress || hubAddress,
      };
      setPendingPoint(pt);
      setPanCommand({ lat: pt.lat, lng: pt.lng });
    } else {
      const pt = {
        lat: value.returnLat || value.pickupLat || hubLat,
        lng: value.returnLng || value.pickupLng || hubLng,
        address: value.returnAddress || value.pickupAddress || hubAddress,
      };
      setPendingPoint(pt);
      setPanCommand({ lat: pt.lat, lng: pt.lng });
    }
  };

  const handleModeChange = (mode: PickupMode) => {
    if (mode === 'branch') {
      void validateAndSync({
        ...value,
        pickupMode: 'branch',
        pickupAddress: hubAddress,
        pickupLat: hubLat,
        pickupLng: hubLng,
        returnAddress: hubAddress,
        returnLat: hubLat,
        returnLng: hubLng,
      });
    } else {
      setPendingPoint({
        lat: value.pickupLat || hubLat,
        lng: value.pickupLng || hubLng,
        address: value.pickupAddress || hubAddress,
      });
      setPanCommand({
        lat: value.pickupLat || hubLat,
        lng: value.pickupLng || hubLng,
      });
      void validateAndSync({
        ...value,
        pickupMode: 'delivery',
      });
    }
  };

  const scheduleReverseGeocode = useCallback(
    (lat: number, lng: number) => {
      setPendingPoint((prev) => ({ ...prev, lat, lng }));
      if (geocodeTimerRef.current) {
        window.clearTimeout(geocodeTimerRef.current);
      }
      setResolvingPin(true);
      geocodeTimerRef.current = window.setTimeout(async () => {
        const addr = await reverseGeocodeCoords(lat, lng);
        setPendingPoint({ lat, lng, address: addr });
        setResolvingPin(false);
      }, 360);
    },
    [reverseGeocodeCoords]
  );

  const handleCameraChanged = (ev: { detail: { center: { lat: number; lng: number } } }) => {
    if (value.pickupMode !== 'delivery') return;
    const lat = Number(ev.detail.center.lat);
    const lng = Number(ev.detail.center.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    scheduleReverseGeocode(lat, lng);
  };

  const handleMarkerDragEnd = async (ev: google.maps.MapMouseEvent) => {
    if (value.pickupMode !== 'delivery' || !ev.latLng) return;
    const lat = ev.latLng.lat();
    const lng = ev.latLng.lng();
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setResolvingPin(true);
    setPendingPoint((prev) => ({ ...prev, lat, lng }));
    setPanCommand({ lat, lng });
    const addr = await reverseGeocodeCoords(lat, lng);
    setPendingPoint({ lat, lng, address: addr });
    setResolvingPin(false);
  };

  useEffect(() => {
    return () => {
      if (geocodeTimerRef.current) window.clearTimeout(geocodeTimerRef.current);
    };
  }, []);

  const handleSelectSuggestion = async (suggestion: google.maps.places.AutocompleteSuggestion) => {
    if (!placesLib || !suggestion.placePrediction) return;
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['location', 'displayName', 'formattedAddress'],
      });
      resetSession();
      setSearchText('');
      if (place.location) {
        const lat = place.location.lat();
        const lng = place.location.lng();
        const address =
          place.formattedAddress ||
          place.displayName ||
          `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        setPendingPoint({ lat, lng, address });
        setPanCommand({ lat, lng });
      }
    } catch (err) {
      console.error('Place fetchFields error:', err);
      const msg = String(err);
      if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
    }
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported in this browser.');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const resolvedAddress = await reverseGeocodeCoords(lat, lng);
        setPendingPoint({ lat, lng, address: resolvedAddress });
        setPanCommand({ lat, lng });
        setGpsLoading(false);
      },
      () => {
        toast.error('Could not retrieve device location. Please check location permissions.');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleConfirmPinLocation = async () => {
    if (activeTab === 'pickup') {
      const next: LocationSelection = {
        ...value,
        pickupMode: 'delivery',
        pickupAddress: pendingPoint.address,
        pickupLat: pendingPoint.lat,
        pickupLng: pendingPoint.lng,
        ...(sameReturn
          ? {
              returnAddress: pendingPoint.address,
              returnLat: pendingPoint.lat,
              returnLng: pendingPoint.lng,
            }
          : {}),
      };
      await validateAndSync(next);
    } else {
      const next: LocationSelection = {
        ...value,
        pickupMode: 'delivery',
        returnAddress: pendingPoint.address,
        returnLat: pendingPoint.lat,
        returnLng: pendingPoint.lng,
      };
      await validateAndSync(next);
    }
  };

  const handleClearPan = useCallback(() => {
    setPanCommand(null);
  }, []);

  const mapBox = (
    <div
      className={
        fullScreenMobile
          ? 'fixed inset-0 z-50 bg-obsidian flex flex-col'
          : 'relative rounded-xl overflow-hidden border border-black/15 h-[320px] sm:h-[380px] lg:h-[430px] w-full bg-alabaster'
      }
    >
      {fullScreenMobile && (
        <div className="p-3 bg-obsidian text-white flex items-center justify-between border-b border-white/10 shrink-0">
          <span className="text-xs font-semibold">Drag Pin or Pan Map & Confirm</span>
          <button
            type="button"
            onClick={() => setFullScreenMobile(false)}
            className="px-3 py-1 bg-gold text-obsidian text-xs font-semibold rounded-md cursor-pointer"
          >
            Done
          </button>
        </div>
      )}

      <div className="relative flex-1 w-full h-full">
        {MAPS_API_KEY ? (
          <>
            <GoogleMap
              mapId="DEMO_MAP_ID"
              defaultCenter={{ lat: hubLat, lng: hubLng }}
              defaultZoom={13}
              gestureHandling="greedy"
              disableDefaultUI={false}
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              onCameraChanged={handleCameraChanged}
              style={{ width: '100%', height: '100%' }}
            >
              <MapPanSync target={panCommand} onPanned={handleClearPan} />

              {/* Branch Service Coverage Circles */}
              {activeBranches.length > 0 ? (
                activeBranches.map((branch) => {
                  const isCurrent = branch.id === (centralHub?.id || vehicle.branchId);
                  return (
                    <React.Fragment key={branch.id}>
                      <Circle
                        center={{ lat: branch.lat, lng: branch.lng }}
                        radius={Number(branch.deliveryRadiusKm || hubRadiusKm) * 1000}
                        strokeColor={isCurrent ? '#C8A24D' : '#6B7280'}
                        strokeOpacity={isCurrent ? 0.85 : 0.45}
                        strokeWeight={isCurrent ? 2 : 1}
                        fillColor={isCurrent ? '#C8A24D' : '#6B7280'}
                        fillOpacity={isCurrent ? 0.08 : 0.03}
                      />
                      <AdvancedMarker position={{ lat: branch.lat, lng: branch.lng }} title={branch.name}>
                        <Pin
                          background={isCurrent ? '#0B0B0D' : '#374151'}
                          borderColor={isCurrent ? '#C8A24D' : '#9CA3AF'}
                          glyphColor={isCurrent ? '#C8A24D' : '#FFFFFF'}
                        />
                      </AdvancedMarker>
                    </React.Fragment>
                  );
                })
              ) : (
                <>
                  <Circle
                    center={{ lat: hubLat, lng: hubLng }}
                    radius={hubRadiusKm * 1000}
                    strokeColor="#C8A24D"
                    strokeOpacity={0.8}
                    strokeWeight={2}
                    fillColor="#C8A24D"
                    fillOpacity={0.07}
                  />
                  <AdvancedMarker position={{ lat: hubLat, lng: hubLng }} title={hubName}>
                    <Pin background="#0B0B0D" borderColor="#C8A24D" glyphColor="#C8A24D" />
                  </AdvancedMarker>
                </>
              )}

              {/* Draggable Delivery Pickup / Return Marker */}
              {value.pickupMode === 'delivery' && (
                <AdvancedMarker
                  position={{ lat: pendingPoint.lat, lng: pendingPoint.lng }}
                  draggable
                  title={activeTab === 'pickup' ? 'Drag to adjust Pickup location' : 'Drag to adjust Return location'}
                  onDragEnd={(ev) => void handleMarkerDragEnd(ev)}
                >
                  <Pin background="#C8A24D" borderColor="#0B0B0D" glyphColor="#0B0B0D" scale={1.15} />
                </AdvancedMarker>
              )}
            </GoogleMap>
          </>
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center p-6 text-center bg-alabaster space-y-2">
            <MapPin className="w-7 h-7 text-gold" />
            <p className="text-sm font-semibold text-ink">
              {hubName} | {hubRadiusKm} km Service Coverage
            </p>
            <p className="text-xs text-slate-muted max-w-sm">
              Interactive map tiles load when Google Maps key is active. Use GPS or enter your {operatingCity} address below and confirm coverage.
            </p>
            {value.pickupMode === 'delivery' && (
              <input
                type="text"
                value={pendingPoint.address}
                onChange={(e) => setPendingPoint((p) => ({ ...p, address: e.target.value }))}
                placeholder={`Enter street / landmark in ${operatingCity}`}
                className="w-full max-w-sm px-3 py-2 text-xs bg-white border border-black/15 rounded-lg"
              />
            )}
          </div>
        )}

        {/* Floating Bottom GPS & Pin Confirmation Bar */}
        {value.pickupMode === 'delivery' && (
          <div className="absolute bottom-3 left-3 right-3 z-20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white/95 backdrop-blur-sm border border-black/15 rounded-xl p-2.5 shadow-lg">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-muted">
                {resolvingPin
                  ? 'Resolving address...'
                  : activeTab === 'pickup'
                    ? 'Selected Pickup Spot (Drag Gold Pin)'
                    : 'Selected Return Spot (Drag Gold Pin)'}
              </p>
              <p className="text-xs font-medium text-ink truncate">{pendingPoint.address}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                disabled={gpsLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-black/15 rounded-lg bg-alabaster hover:border-gold cursor-pointer whitespace-nowrap"
              >
                <LocateFixed className="w-3.5 h-3.5 text-gold-hover" />
                {gpsLoading ? 'Locating...' : 'Use My Current Location'}
              </button>
              <button
                type="button"
                disabled={validating}
                onClick={() => void handleConfirmPinLocation()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-obsidian text-white rounded-lg hover:bg-graphite cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Navigation className="w-3.5 h-3.5 text-gold" />
                {activeTab === 'pickup' ? 'Confirm Pickup' : 'Confirm Return'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Pickup Mode Toggle + Mobile Fullscreen Map Button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap p-1 bg-alabaster border border-black/10 rounded-lg">
          <button
            type="button"
            onClick={() => handleModeChange('branch')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              value.pickupMode === 'branch'
                ? 'bg-obsidian text-white'
                : 'text-slate-muted hover:text-ink'
            }`}
          >
            Self Pickup ({operatingCity} Hub — Free)
          </button>
          <button
            type="button"
            disabled={!vehicle.deliveryEligible}
            onClick={() => handleModeChange('delivery')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 ${
              value.pickupMode === 'delivery'
                ? 'bg-obsidian text-white'
                : 'text-slate-muted hover:text-ink'
            }`}
          >
            Doorstep Delivery ({operatingCity})
          </button>
        </div>

        <button
          type="button"
          onClick={() => setFullScreenMobile((prev) => !prev)}
          className="lg:hidden inline-flex items-center gap-1.5 text-xs font-semibold text-ink border border-black/15 px-3 py-1.5 rounded-md cursor-pointer"
        >
          {fullScreenMobile ? (
            <Minimize2 className="w-3.5 h-3.5" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5" />
          )}
          {fullScreenMobile ? 'Close Map' : 'Expand Map'}
        </button>
      </div>

      {/* Desktop Side-by-Side (Controls Left / Interactive Map Right) + Mobile Stack */}
      <div className="grid lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-5 space-y-3">
          {value.pickupMode === 'delivery' ? (
            <div className="space-y-3 p-3.5 rounded-xl border border-black/10 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex p-1 bg-alabaster border border-black/10 rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => handleSwitchPinTab('pickup')}
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
                      activeTab === 'pickup' ? 'bg-gold text-obsidian' : 'text-slate-muted hover:text-ink'
                    }`}
                  >
                    1. Pickup Spot
                  </button>
                  <button
                    type="button"
                    disabled={sameReturn}
                    onClick={() => handleSwitchPinTab('return')}
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer disabled:opacity-40 ${
                      activeTab === 'return' ? 'bg-gold text-obsidian' : 'text-slate-muted hover:text-ink'
                    }`}
                  >
                    2. Return Spot
                  </button>
                </div>

                <label className="inline-flex items-center gap-1.5 text-[11px] text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sameReturn}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSameReturn(checked);
                      if (checked) {
                        setActiveTab('pickup');
                        void validateAndSync({
                          ...value,
                          returnAddress: value.pickupAddress,
                          returnLat: value.pickupLat,
                          returnLng: value.pickupLng,
                        });
                      }
                    }}
                    className="accent-obsidian"
                  />
                  <span>Same return spot</span>
                </label>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder={`Search landmark or area in ${operatingCity}...`}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                />
                {(suggestions.length > 0 || searchLoading) && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-black/15 rounded-lg shadow-xl z-30 max-h-56 overflow-y-auto">
                    {searchLoading && (
                      <div className="px-3 py-2 text-xs text-slate-muted">Searching places...</div>
                    )}
                    {suggestions.map((sug, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => void handleSelectSuggestion(sug)}
                        className="w-full text-left px-3 py-2.5 text-xs hover:bg-alabaster border-b border-black/5 last:border-0 flex items-start gap-2 cursor-pointer"
                      >
                        <MapPin className="w-3.5 h-3.5 text-gold shrink-0 mt-0.5" />
                        <span>{sug.placePrediction?.text.text}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {savedAddresses.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {savedAddresses.map((addr) => (
                    <button
                      key={addr.id}
                      type="button"
                      onClick={() => {
                        setPendingPoint({ lat: addr.lat, lng: addr.lng, address: addr.address });
                        setPanCommand({ lat: addr.lat, lng: addr.lng });
                      }}
                      className="text-[11px] px-2.5 py-1 border border-black/15 rounded-md bg-alabaster hover:border-gold transition-colors cursor-pointer"
                    >
                      {addr.label}: {addr.cityName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-3.5 rounded-xl border border-black/10 bg-white space-y-1 text-xs">
              <p className="font-semibold text-ink">Hub Self-Pickup Selected</p>
              <p className="text-slate-muted leading-relaxed">
                Collect keys directly at <strong>{hubName}</strong> ({hubAddress}). Switch to Doorstep Delivery above to drop a custom pickup pin.
              </p>
            </div>
          )}

          {/* Confirmed Pickup & Return Readout */}
          <div className="space-y-2.5">
            <div className="p-3 rounded-lg border border-black/10 bg-alabaster">
              <p className="text-[11px] font-semibold text-slate-muted">Confirmed Pickup Location</p>
              <p className="text-xs font-semibold text-ink mt-1 leading-relaxed">
                {value.pickupAddress}
              </p>
              {value.pickupMode === 'delivery' && value.distanceKm !== undefined && (
                <p className="text-[11px] font-mono tabular-nums text-slate-muted mt-1">
                  {value.distanceKm} km from {hubName}
                </p>
              )}
            </div>

            <div className="p-3 rounded-lg border border-black/10 bg-alabaster">
              <p className="text-[11px] font-semibold text-slate-muted">Confirmed Return Location</p>
              <p className="text-xs font-semibold text-ink mt-1 leading-relaxed">
                {value.returnAddress || value.pickupAddress}
              </p>
              <p className="text-[11px] text-slate-muted mt-1">
                Service zone: {operatingCity} ({hubRadiusKm} km radius)
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7">{mapBox}</div>
      </div>

      {/* Backend Serviceability Status + Nearest Branch Suggestion */}
      <div
        className={`p-3 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs ${
          validating
            ? 'border-black/10 bg-alabaster text-slate-muted'
            : value.serviceable
              ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
              : 'border-red-200 bg-red-50 text-red-950'
        }`}
      >
        <div className="flex items-start gap-2.5 flex-1">
          {value.serviceable ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
          )}
          <div>
            {validating ? (
              <span>Validating {operatingCity} service radius and doorstep delivery fees...</span>
            ) : value.serviceable ? (
              <span className="font-medium">
                {operatingCity} serviceable zone verified |{' '}
                {value.pickupMode === 'delivery'
                  ? `Doorstep delivery fee ${formatINR(value.deliveryCharge)}`
                  : 'Free Central Hub self-pickup'}
              </span>
            ) : (
              <span className="font-medium">{value.serviceReason}</span>
            )}
          </div>
        </div>

        {!validating && !value.serviceable && value.suggestedBranch && (
          <button
            type="button"
            onClick={() => navigate(`/vehicles?branchId=${encodeURIComponent(value.suggestedBranch!.branchId)}`)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-obsidian text-white text-xs font-semibold rounded-lg hover:bg-graphite whitespace-nowrap shrink-0 cursor-pointer"
          >
            Switch to {value.suggestedBranch.branchName} ({value.suggestedBranch.distanceKm} km)
            <ArrowRight className="w-3.5 h-3.5 text-gold" />
          </button>
        )}
      </div>
    </div>
  );
};

export const LocationMapPicker: React.FC<LocationMapPickerProps> = (props) => {
  if (!MAPS_API_KEY) {
    return <InnerMapWidget {...props} />;
  }
  return (
    <APIProvider apiKey={MAPS_API_KEY} language="en" region="IN">
      <InnerMapWidget {...props} />
    </APIProvider>
  );
};

