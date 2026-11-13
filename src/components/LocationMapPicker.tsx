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
  Building2,
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

  // Branch visibility MUST hide all branch UI whenever activeBranches.length === 0
  const activeBranches = branches.filter((b) => b.active === true);
  const hasBranches = activeBranches.length > 0;

  const selectedActiveBranch = hasBranches
    ? activeBranches.find((b) => b.id === value.pickupBranchId) ||
      activeBranches.find((b) => b.id === vehicle.branchId) ||
      activeBranches[0]
    : null;

  const hubLat = Number(selectedActiveBranch?.lat ?? settings?.hubLat ?? 19.076);
  const hubLng = Number(selectedActiveBranch?.lng ?? settings?.hubLng ?? 72.8777);
  const hubRadiusKm = Number(
    selectedActiveBranch?.deliveryRadiusKm ?? settings?.serviceRadiusKm ?? 25
  );
  const operatingCity =
    selectedActiveBranch?.cityName ||
    settings?.operatingCityName ||
    vehicle.cityName ||
    'Mumbai';
  const hubAddress =
    selectedActiveBranch?.address ||
    settings?.businessAddress ||
    `${operatingCity} Central Fleet Lounge`;
  const hubName =
    selectedActiveBranch?.name ||
    settings?.officeName ||
    `${operatingCity} Central Hub`;

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
            pickupBranchId: hasBranches ? draft.pickupBranchId : 'branch-central-hub',
            pickupMode: draft.pickupMode,
            pickupLat: draft.pickupLat,
            pickupLng: draft.pickupLng,
            returnLat: draft.returnLat,
            returnLng: draft.returnLng,
          }),
        });

        const resolvedBranchId =
          res.branchId || selectedActiveBranch?.id || draft.pickupBranchId || 'branch-central-hub';
        onChange({
          ...draft,
          pickupBranchId: resolvedBranchId,
          returnBranchId: selectedActiveBranch?.id || draft.returnBranchId || 'branch-central-hub',
          isOneWay: false,
          serviceable: res.serviceable,
          serviceReason: res.reason,
          distanceKm: res.distanceKm,
          deliveryCharge: res.deliveryCharge || 0,
          oneWayCharge: res.oneWayCharge || 0,
          suggestedBranch: hasBranches ? res.suggestedBranch || null : null,
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
    [vehicle.id, hasBranches, selectedActiveBranch?.id, onChange]
  );

  const handleSelectBranch = (branchId: string) => {
    const chosen = activeBranches.find((b) => b.id === branchId);
    if (!chosen) return;
    setPanCommand({ lat: chosen.lat, lng: chosen.lng });
    if (value.pickupMode === 'branch') {
      void validateAndSync({
        ...value,
        pickupBranchId: chosen.id,
        returnBranchId: chosen.id,
        pickupAddress: chosen.address,
        pickupLat: chosen.lat,
        pickupLng: chosen.lng,
        returnAddress: chosen.address,
        returnLat: chosen.lat,
        returnLng: chosen.lng,
      });
    } else {
      void validateAndSync({
        ...value,
        pickupBranchId: chosen.id,
        returnBranchId: chosen.id,
      });
    }
  };

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
          : 'relative rounded-xl overflow-hidden border border-white/15 h-[320px] sm:h-[380px] lg:h-[420px] w-full bg-obsidian'
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

            {hasBranches ? (
              activeBranches.map((branch) => {
                const isCurrent = branch.id === selectedActiveBranch?.id;
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
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center p-6 text-center bg-navy-deep space-y-2.5 text-ivory">
            <MapPin className="w-7 h-7 text-gold" />
            <p className="text-sm font-semibold text-white">
              {hubName} · {hubRadiusKm} km Service Coverage
            </p>
            <p className="text-xs text-ivory/65 max-w-sm">
              Enter your {operatingCity} street address or landmark below or enable GPS to verify delivery radius.
            </p>
            {value.pickupMode === 'delivery' && (
              <input
                type="text"
                value={pendingPoint.address}
                onChange={(e) => setPendingPoint((p) => ({ ...p, address: e.target.value }))}
                placeholder={`Enter street / landmark in ${operatingCity}`}
                className="w-full max-w-sm px-3 py-2 text-xs bg-obsidian border border-white/15 rounded-lg text-white placeholder:text-ivory/40"
              />
            )}
          </div>
        )}

        {value.pickupMode === 'delivery' && (
          <div className="absolute bottom-3 left-3 right-3 z-20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-obsidian/95 backdrop-blur-md border border-white/15 rounded-xl p-2.5 shadow-xl">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gold">
                {resolvingPin
                  ? 'Resolving address...'
                  : activeTab === 'pickup'
                    ? 'Selected Pickup Spot (Drag Gold Pin)'
                    : 'Selected Return Spot (Drag Gold Pin)'}
              </p>
              <p className="text-xs font-medium text-white truncate">{pendingPoint.address}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                disabled={gpsLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-white/20 rounded-lg bg-navy-deep text-ivory hover:border-gold cursor-pointer whitespace-nowrap"
              >
                <LocateFixed className="w-3.5 h-3.5 text-gold" />
                {gpsLoading ? 'Locating...' : 'Use GPS'}
              </button>
              <button
                type="button"
                disabled={validating}
                onClick={() => void handleConfirmPinLocation()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-gold text-obsidian rounded-lg hover:bg-gold-bright cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Navigation className="w-3.5 h-3.5" />
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
      {/* Pickup Mode Toggle + Branch Picker ONLY when activeBranches.length > 0 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap p-1 bg-obsidian border border-white/15 rounded-xl">
          <button
            type="button"
            onClick={() => handleModeChange('branch')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              value.pickupMode === 'branch'
                ? 'bg-gold text-obsidian'
                : 'text-ivory/70 hover:text-white'
            }`}
          >
            Self Pickup ({operatingCity} Lounge — Free)
          </button>
          <button
            type="button"
            disabled={!vehicle.deliveryEligible}
            onClick={() => handleModeChange('delivery')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 ${
              value.pickupMode === 'delivery'
                ? 'bg-gold text-obsidian'
                : 'text-ivory/70 hover:text-white'
            }`}
          >
            Doorstep Delivery ({operatingCity})
          </button>
        </div>

        <button
          type="button"
          onClick={() => setFullScreenMobile((prev) => !prev)}
          className="lg:hidden inline-flex items-center gap-1.5 text-xs font-semibold text-ivory border border-white/15 px-3 py-1.5 rounded-lg cursor-pointer"
        >
          {fullScreenMobile ? (
            <Minimize2 className="w-3.5 h-3.5 text-gold" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5 text-gold" />
          )}
          {fullScreenMobile ? 'Close Map' : 'Expand Map'}
        </button>
      </div>

      {/* Render Branch Switcher ONLY when active branches exist in DB */}
      {hasBranches && activeBranches.length > 1 && (
        <div className="p-3 rounded-xl bg-obsidian/70 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-semibold text-ivory">
            <Building2 className="w-3.5 h-3.5 text-gold" />
            Active Pickup Branch
          </span>
          <select
            value={selectedActiveBranch?.id || ''}
            onChange={(e) => handleSelectBranch(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-navy-deep border border-white/15 text-ivory text-xs focus:outline-none focus:border-gold"
          >
            {activeBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} — {b.cityName}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Side-by-Side Controls & Map */}
      <div className="grid lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-5 space-y-3">
          {value.pickupMode === 'delivery' ? (
            <div className="space-y-3 p-3.5 rounded-xl border border-white/10 bg-obsidian/70">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex p-1 bg-navy-deep border border-white/10 rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => handleSwitchPinTab('pickup')}
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
                      activeTab === 'pickup' ? 'bg-gold text-obsidian' : 'text-ivory/70 hover:text-white'
                    }`}
                  >
                    1. Pickup Spot
                  </button>
                  <button
                    type="button"
                    disabled={sameReturn}
                    onClick={() => handleSwitchPinTab('return')}
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer disabled:opacity-40 ${
                      activeTab === 'return' ? 'bg-gold text-obsidian' : 'text-ivory/70 hover:text-white'
                    }`}
                  >
                    2. Return Spot
                  </button>
                </div>

                <label className="inline-flex items-center gap-1.5 text-[11px] text-ivory cursor-pointer">
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
                    className="accent-gold"
                  />
                  <span>Same return spot</span>
                </label>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-ivory/50 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder={`Search landmark or area in ${operatingCity}...`}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-navy-deep border border-white/15 rounded-lg text-white placeholder:text-ivory/40 focus:outline-none focus:border-gold"
                />
                {(suggestions.length > 0 || searchLoading) && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-obsidian border border-white/15 rounded-lg shadow-2xl z-30 max-h-56 overflow-y-auto">
                    {searchLoading && (
                      <div className="px-3 py-2 text-xs text-ivory/60">Searching places...</div>
                    )}
                    {suggestions.map((sug, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => void handleSelectSuggestion(sug)}
                        className="w-full text-left px-3 py-2.5 text-xs text-ivory hover:bg-white/5 border-b border-white/10 last:border-0 flex items-start gap-2 cursor-pointer"
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
                      className="text-[11px] px-2.5 py-1 border border-white/15 rounded-md bg-navy-deep text-ivory hover:border-gold transition-colors cursor-pointer"
                    >
                      {addr.label}: {addr.cityName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-3.5 rounded-xl border border-white/10 bg-obsidian/70 space-y-1 text-xs">
              <p className="font-semibold text-white">Lounge Self-Pickup Selected</p>
              <p className="text-ivory/70 leading-relaxed">
                Collect keys directly at <strong className="text-gold">{hubName}</strong> ({hubAddress}). Switch to Doorstep Delivery above to drop a custom pickup pin.
              </p>
            </div>
          )}

          {/* Confirmed Pickup & Return Readout */}
          <div className="space-y-2.5">
            <div className="p-3 rounded-xl border border-white/10 bg-obsidian/60">
              <p className="text-[11px] font-semibold text-ivory/55">Confirmed Pickup Location</p>
              <p className="text-xs font-semibold text-white mt-1 leading-relaxed">
                {value.pickupAddress}
              </p>
              {value.pickupMode === 'delivery' && value.distanceKm !== undefined && (
                <p className="text-[11px] font-mono tabular-nums text-gold mt-1">
                  {value.distanceKm} km from {hubName}
                </p>
              )}
            </div>

            <div className="p-3 rounded-xl border border-white/10 bg-obsidian/60">
              <p className="text-[11px] font-semibold text-ivory/55">Confirmed Return Location</p>
              <p className="text-xs font-semibold text-white mt-1 leading-relaxed">
                {value.returnAddress || value.pickupAddress}
              </p>
              <p className="text-[11px] text-ivory/55 mt-1">
                Service zone: {operatingCity} ({hubRadiusKm} km radius)
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7">{mapBox}</div>
      </div>

      {/* Serviceability Verification Banner */}
      <div
        className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs ${
          validating
            ? 'border-white/15 bg-obsidian/60 text-ivory/70'
            : value.serviceable
              ? 'border-emerald-500/30 bg-emerald-950/30 text-emerald-200'
              : 'border-red-500/35 bg-red-950/35 text-red-200'
        }`}
      >
        <div className="flex items-start gap-2.5 flex-1">
          {value.serviceable ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          )}
          <div>
            {validating ? (
              <span>Validating {operatingCity} service radius and doorstep delivery fees...</span>
            ) : value.serviceable ? (
              <span className="font-medium">
                {operatingCity} serviceable zone verified ·{' '}
                {value.pickupMode === 'delivery'
                  ? `Doorstep delivery fee ${formatINR(value.deliveryCharge)}`
                  : 'Free Central Lounge self-pickup'}
              </span>
            ) : (
              <span className="font-medium">{value.serviceReason}</span>
            )}
          </div>
        </div>

        {hasBranches && !validating && !value.serviceable && value.suggestedBranch && (
          <button
            type="button"
            onClick={() =>
              navigate(`/vehicles?branchId=${encodeURIComponent(value.suggestedBranch!.branchId)}`)
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gold text-obsidian text-xs font-semibold rounded-lg hover:bg-gold-bright whitespace-nowrap shrink-0 cursor-pointer"
          >
            Switch to {value.suggestedBranch.branchName} ({value.suggestedBranch.distanceKm} km)
            <ArrowRight className="w-3.5 h-3.5" />
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
