import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  APIProvider,
  AdvancedMarker,
  Circle,
  Map as GoogleMap,
  type MapMouseEvent,
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
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCatalog } from '../context/CatalogContext';
import { apiFetch, formatINR } from '../lib/api';
import type { Branch, PickupMode, ResolvedLocationData, SavedAddress, Vehicle } from '../types';

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
  mode?: 'pickup' | 'return' | 'combined';
  onConfirmed?: (selection: LocationSelection) => void;
}

interface PendingPinState {
  lat: number;
  lng: number;
  address: string;
  locality?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

function useAutocompleteSuggestions(input: string, biasCenter: { lat: number; lng: number } | null) {
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
        ...(biasCenter
          ? {
              locationBias: {
                center: biasCenter,
                radius: 45000,
              },
            }
          : {}),
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
  }, [placesLib, input, biasCenter?.lat, biasCenter?.lng]);

  const resetSession = useCallback(() => {
    sessionTokenRef.current = null;
    setSuggestions([]);
  }, []);

  return { suggestions, loading, resetSession, placesLib };
}

const MapPanSync: React.FC<{
  target: { lat: number; lng: number; zoom?: number } | null;
  onPanned?: () => void;
}> = ({ target, onPanned }) => {
  const map = useMap();
  useEffect(() => {
    if (map && target) {
      map.panTo({ lat: target.lat, lng: target.lng });
      map.setZoom(target.zoom || 15);
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
  mode = 'combined',
  onConfirmed,
}) => {
  const navigate = useNavigate();
  const { settings } = useCatalog();

  const activeBranches = branches.filter((b) => b.active === true);
  const hasBranches = activeBranches.length > 0;

  const selectedActiveBranch = hasBranches
    ? activeBranches.find((b) => b.id === value.pickupBranchId) ||
      activeBranches.find((b) => b.id === vehicle.branchId) ||
      activeBranches[0]
    : null;

  const hasConfiguredHubCoords =
    typeof selectedActiveBranch?.lat === 'number' &&
    Number.isFinite(selectedActiveBranch.lat) &&
    typeof selectedActiveBranch?.lng === 'number' &&
    Number.isFinite(selectedActiveBranch.lng)
      ? true
      : typeof settings?.hubLat === 'number' &&
          Number.isFinite(settings.hubLat) &&
          typeof settings?.hubLng === 'number' &&
          Number.isFinite(settings.hubLng);

  const hubLat = Number(selectedActiveBranch?.lat ?? settings?.hubLat ?? 20.5937);
  const hubLng = Number(selectedActiveBranch?.lng ?? settings?.hubLng ?? 78.9629);
  const hubRadiusKm = Number(
    selectedActiveBranch?.deliveryRadiusKm ?? settings?.serviceRadiusKm ?? 25
  );
  const operatingCity =
    selectedActiveBranch?.cityName ||
    settings?.operatingCityName ||
    vehicle.cityName ||
    '';
  const hubAddress =
    selectedActiveBranch?.address ||
    settings?.businessAddress ||
    (operatingCity ? `${operatingCity} Rental Lounge` : 'Main Rental Lounge');
  const hubName =
    selectedActiveBranch?.name ||
    settings?.officeName ||
    (operatingCity ? `${operatingCity} Hub` : 'Main Hub');

  const isReturnOnly = mode === 'return';
  const isPickupOnly = mode === 'pickup';
  const [activeTab, setActiveTab] = useState<'pickup' | 'return'>(
    isReturnOnly ? 'return' : 'pickup'
  );
  const [sameReturn, setSameReturn] = useState(
    !isReturnOnly &&
      value.returnLat === value.pickupLat &&
      value.returnLng === value.pickupLng
  );

  useEffect(() => {
    if (mode === 'return') {
      setActiveTab('return');
      setSameReturn(false);
    } else if (mode === 'pickup') {
      setActiveTab('pickup');
    }
  }, [mode]);

  const [searchText, setSearchText] = useState('');
  const [validating, setValidating] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [fullScreenMobile, setFullScreenMobile] = useState(false);

  const initialLat =
    activeTab === 'return'
      ? value.returnLat || value.pickupLat || hubLat
      : value.pickupLat || hubLat;
  const initialLng =
    activeTab === 'return'
      ? value.returnLng || value.pickupLng || hubLng
      : value.pickupLng || hubLng;
  const initialAddress =
    activeTab === 'return'
      ? value.returnAddress || value.pickupAddress || ''
      : value.pickupAddress || '';

  const [pendingPoint, setPendingPoint] = useState<PendingPinState>(() => ({
    lat: initialLat,
    lng: initialLng,
    address: initialAddress,
  }));
  const [panCommand, setPanCommand] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [resolvingPin, setResolvingPin] = useState(false);
  const geocodeTimerRef = useRef<number | null>(null);

  const biasCenter = hasConfiguredHubCoords ? { lat: hubLat, lng: hubLng } : null;
  const { suggestions, loading: searchLoading, resetSession, placesLib } =
    useAutocompleteSuggestions(searchText, biasCenter);

  const reverseGeocodeCoords = useCallback(
    async (lat: number, lng: number): Promise<PendingPinState> => {
      try {
        const geo = await apiFetch<ResolvedLocationData>(
          `/api/maps/reverse-geocode?lat=${lat}&lng=${lng}`
        );
        return {
          lat,
          lng,
          address: geo.formattedAddress || geo.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          locality: geo.locality || '',
          city: geo.city || '',
          state: geo.state || '',
          postalCode: geo.postalCode || '',
        };
      } catch {
        return {
          lat,
          lng,
          address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        };
      }
    },
    []
  );

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
            isOneWay: draft.isOneWay,
          }),
        });

        const resolvedBranchId =
          res.branchId || selectedActiveBranch?.id || draft.pickupBranchId || 'branch-central-hub';
        const nextSelection: LocationSelection = {
          ...draft,
          pickupBranchId: resolvedBranchId,
          returnBranchId: selectedActiveBranch?.id || draft.returnBranchId || 'branch-central-hub',
          serviceable: res.serviceable,
          serviceReason: res.reason,
          distanceKm: res.distanceKm,
          deliveryCharge: res.deliveryCharge || 0,
          oneWayCharge: res.oneWayCharge || 0,
          suggestedBranch: hasBranches ? res.suggestedBranch || null : null,
        };
        onChange(nextSelection);
        return nextSelection;
      } catch (err: any) {
        const fallbackSelection: LocationSelection = {
          ...draft,
          serviceable: false,
          serviceReason: err.message || 'Unable to verify coverage.',
          suggestedBranch: null,
        };
        onChange(fallbackSelection);
        return fallbackSelection;
      } finally {
        setValidating(false);
      }
    },
    [vehicle.id, hasBranches, selectedActiveBranch?.id, onChange]
  );

  const handleSelectBranch = (branchId: string) => {
    const chosen = activeBranches.find((b) => b.id === branchId);
    if (!chosen) return;
    setPanCommand({ lat: chosen.lat, lng: chosen.lng, zoom: 14 });
    if (value.pickupMode === 'branch' && !isReturnOnly) {
      setPendingPoint({
        lat: chosen.lat,
        lng: chosen.lng,
        address: chosen.address,
        city: chosen.cityName,
      });
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
        address: value.pickupAddress || '',
      };
      setPendingPoint(pt);
      setPanCommand({ lat: pt.lat, lng: pt.lng, zoom: 15 });
    } else {
      const pt = {
        lat: value.returnLat || value.pickupLat || hubLat,
        lng: value.returnLng || value.pickupLng || hubLng,
        address: value.returnAddress || value.pickupAddress || '',
      };
      setPendingPoint(pt);
      setPanCommand({ lat: pt.lat, lng: pt.lng, zoom: 15 });
    }
  };

  const handleModeChange = (nextMode: PickupMode) => {
    if (nextMode === 'branch') {
      setPendingPoint({ lat: hubLat, lng: hubLng, address: hubAddress, city: operatingCity });
      setPanCommand({ lat: hubLat, lng: hubLng, zoom: 14 });
      void validateAndSync({
        ...value,
        pickupMode: 'branch',
        pickupAddress: hubAddress,
        pickupLat: hubLat,
        pickupLng: hubLng,
        ...(isPickupOnly || sameReturn
          ? {
              returnAddress: hubAddress,
              returnLat: hubLat,
              returnLng: hubLng,
              isOneWay: false,
            }
          : {}),
      });
    } else {
      const pt = {
        lat: value.pickupLat || hubLat,
        lng: value.pickupLng || hubLng,
        address: value.pickupAddress || hubAddress,
      };
      setPendingPoint(pt);
      setPanCommand({ lat: pt.lat, lng: pt.lng, zoom: 15 });
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
        const resolved = await reverseGeocodeCoords(lat, lng);
        setPendingPoint(resolved);
        setResolvingPin(false);
      }, 280);
    },
    [reverseGeocodeCoords]
  );

  const handleMapClick = (ev: MapMouseEvent) => {
    if (!isReturnOnly && value.pickupMode !== 'delivery') return;
    const lat = ev.detail?.latLng?.lat;
    const lng = ev.detail?.latLng?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    setPanCommand({ lat, lng, zoom: 16 });
    scheduleReverseGeocode(lat, lng);
  };

  const handleMarkerDragEnd = async (ev: google.maps.MapMouseEvent) => {
    if ((!isReturnOnly && value.pickupMode !== 'delivery') || !ev.latLng) return;
    const lat = ev.latLng.lat();
    const lng = ev.latLng.lng();
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setResolvingPin(true);
    setPendingPoint((prev) => ({ ...prev, lat, lng }));
    setPanCommand({ lat, lng, zoom: 16 });
    const resolved = await reverseGeocodeCoords(lat, lng);
    setPendingPoint(resolved);
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
        setResolvingPin(true);
        setPanCommand({ lat, lng, zoom: 16 });
        const resolved = await reverseGeocodeCoords(lat, lng);
        const preferredAddress =
          place.formattedAddress || resolved.formattedAddress || resolved.address || place.displayName || '';
        setPendingPoint({
          ...resolved,
          lat,
          lng,
          address: preferredAddress || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        });
        setResolvingPin(false);
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
        setPanCommand({ lat, lng, zoom: 16 });
        const resolved = await reverseGeocodeCoords(lat, lng);
        setPendingPoint(resolved);
        setGpsLoading(false);
      },
      () => {
        toast.error('Could not retrieve device location. Please check browser location permissions.');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleConfirmPinLocation = async () => {
    const cleanAddress = pendingPoint.address.trim();
    if (!cleanAddress) {
      toast.error('Please pick a location on the map or search an address first.');
      return;
    }
    if (isReturnOnly || activeTab === 'return') {
      const next: LocationSelection = {
        ...value,
        returnAddress: cleanAddress,
        returnLat: pendingPoint.lat,
        returnLng: pendingPoint.lng,
        isOneWay: true,
      };
      const synced = await validateAndSync(next);
      setFullScreenMobile(false);
      onConfirmed?.(synced);
    } else {
      const next: LocationSelection = {
        ...value,
        pickupMode: 'delivery',
        pickupAddress: cleanAddress,
        pickupLat: pendingPoint.lat,
        pickupLng: pendingPoint.lng,
        ...(isPickupOnly || sameReturn
          ? {
              returnAddress: cleanAddress,
              returnLat: pendingPoint.lat,
              returnLng: pendingPoint.lng,
            }
          : {}),
      };
      const synced = await validateAndSync(next);
      setFullScreenMobile(false);
      onConfirmed?.(synced);
    }
  };

  const handleClearPan = useCallback(() => {
    setPanCommand(null);
  }, []);

  const showInteractivePin = isReturnOnly || value.pickupMode === 'delivery';
  const locationMetaLine = [pendingPoint.locality, pendingPoint.city, pendingPoint.state, pendingPoint.postalCode]
    .filter(Boolean)
    .join(', ');

  const mapSurface = (
    <div
      className={
        fullScreenMobile
          ? 'fixed inset-0 z-50 h-[100dvh] overflow-hidden bg-obsidian flex flex-col'
          : 'relative rounded-2xl overflow-hidden border border-white/15 bg-obsidian shadow-lg'
      }
    >
      {fullScreenMobile && (
        <div className="px-4 py-3 bg-obsidian text-white flex items-center justify-between border-b border-white/10 shrink-0">
          <span className="text-xs font-semibold">
            {isReturnOnly || activeTab === 'return'
              ? 'Select Return Location'
              : 'Select Pickup Location'}
          </span>
          <button
            type="button"
            onClick={() => setFullScreenMobile(false)}
            className="px-3 py-1 bg-gold text-obsidian text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap shrink-0"
          >
            Done
          </button>
        </div>
      )}

      {/* Top Autocomplete Search Overlay Bar (Ola/Uber style) */}
      {showInteractivePin && (
        <div className="p-3 bg-obsidian/95 border-b border-white/10 relative z-30">
          <div className="relative">
            <Search className="w-4 h-4 text-gold absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={
                isReturnOnly || activeTab === 'return'
                  ? 'Search return street, area, landmark, or city...'
                  : 'Search pickup street, area, landmark, or city...'
              }
              className="w-full pl-9 pr-9 py-2.5 text-xs bg-navy-deep border border-white/15 rounded-xl text-white placeholder:text-ivory/45 focus:outline-none focus:border-gold"
            />
            {searchText && (
              <button
                type="button"
                aria-label="Clear location search"
                onClick={() => {
                  setSearchText('');
                  resetSession();
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ivory/60 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {(suggestions.length > 0 || searchLoading) && (
            <div className="absolute left-3 right-3 top-full mt-1 bg-obsidian border border-white/15 rounded-xl shadow-2xl z-40 max-h-60 overflow-y-auto">
              {searchLoading && (
                <div className="px-3 py-2.5 text-xs text-ivory/60">Searching places...</div>
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

          {savedAddresses.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {savedAddresses.map((addr) => (
                <button
                  key={addr.id}
                  type="button"
                  onClick={() => {
                    setPendingPoint({
                      lat: addr.lat,
                      lng: addr.lng,
                      address: addr.address,
                      city: addr.cityName,
                    });
                    setPanCommand({ lat: addr.lat, lng: addr.lng, zoom: 16 });
                  }}
                  className="text-[11px] px-2.5 py-1 border border-white/15 rounded-lg bg-navy-deep text-ivory hover:border-gold transition-colors cursor-pointer"
                >
                  {addr.label}: {addr.cityName}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Map Canvas Container with Explicit Height */}
      <div
        className={
          fullScreenMobile
            ? 'relative flex-1 w-full min-h-[320px]'
            : 'relative w-full h-[320px] sm:h-[380px]'
        }
      >
        {MAPS_API_KEY ? (
          <GoogleMap
            mapId="DEMO_MAP_ID"
            defaultCenter={{
              lat: pendingPoint.lat || hubLat,
              lng: pendingPoint.lng || hubLng,
            }}
            defaultZoom={hasConfiguredHubCoords ? 13 : 5}
            gestureHandling="greedy"
            disableDefaultUI={false}
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            onClick={handleMapClick}
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
            ) : hasConfiguredHubCoords ? (
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
            ) : null}

            {showInteractivePin && (
              <AdvancedMarker
                position={{ lat: pendingPoint.lat, lng: pendingPoint.lng }}
                draggable
                title={
                  isReturnOnly || activeTab === 'return'
                    ? 'Drag pin to adjust Return location'
                    : 'Drag pin to adjust Pickup location'
                }
                onDragEnd={(ev) => void handleMarkerDragEnd(ev)}
              >
                <Pin background="#C8A24D" borderColor="#0B0B0D" glyphColor="#0B0B0D" scale={1.2} />
              </AdvancedMarker>
            )}
          </GoogleMap>
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center p-6 text-center bg-navy-deep space-y-3 text-ivory">
            <MapPin className="w-7 h-7 text-gold" />
            <p className="text-sm font-semibold text-white">
              {hubName} · {hubRadiusKm} km Service Coverage
            </p>
            <p className="text-xs text-ivory/65 max-w-sm">
              Enter your full street address or landmark below, or tap Use Current Location to verify serviceability.
            </p>
            {showInteractivePin && (
              <input
                type="text"
                value={pendingPoint.address}
                onChange={(e) => setPendingPoint((p) => ({ ...p, address: e.target.value }))}
                placeholder="Enter street address, landmark & PIN code"
                className="w-full max-w-sm px-3 py-2 text-xs bg-obsidian border border-white/15 rounded-lg text-white placeholder:text-ivory/40"
              />
            )}
          </div>
        )}

        {/* Floating GPS Current Location Pill (Top-Right over map) */}
        {showInteractivePin && (
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={gpsLoading}
            className="absolute top-3 right-3 z-20 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-white/20 rounded-xl bg-obsidian/95 text-ivory hover:border-gold shadow-xl cursor-pointer whitespace-nowrap"
          >
            <LocateFixed className="w-3.5 h-3.5 text-gold" />
            {gpsLoading ? 'Locating...' : 'Use Current Location'}
          </button>
        )}
      </div>

      {/* Bottom Selected Address Confirmation Card (Ola/Uber Style) */}
      {showInteractivePin ? (
        <div
          className={`p-3.5 bg-obsidian border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 ${
            fullScreenMobile ? 'pb-[max(0.875rem,env(safe-area-inset-bottom))]' : ''
          }`}
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gold">
              {resolvingPin
                ? 'Resolving address...'
                : isReturnOnly || activeTab === 'return'
                  ? 'Selected Return Spot (Click map or drag pin)'
                  : 'Selected Pickup Spot (Click map or drag pin)'}
            </p>
            <p className="text-xs sm:text-sm font-semibold text-white truncate">
              {pendingPoint.address || 'Tap on map or search above to pick your address'}
            </p>
            {locationMetaLine && (
              <p className="text-[11px] text-ivory/60 truncate">{locationMetaLine}</p>
            )}
          </div>

          <button
            type="button"
            disabled={validating || resolvingPin || !pendingPoint.address.trim()}
            onClick={() => void handleConfirmPinLocation()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold bg-gold text-obsidian rounded-xl hover:bg-gold-bright cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Navigation className="w-3.5 h-3.5" />
            {validating
              ? 'Checking...'
              : isReturnOnly || activeTab === 'return'
                ? 'Confirm Return Location'
                : 'Confirm Location'}
          </button>
        </div>
      ) : (
        <div className="p-3.5 bg-obsidian border-t border-white/10 text-xs flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-white">Self-Pickup at {hubName}</p>
            <p className="text-ivory/65">{hubAddress}</p>
          </div>
          <span className="text-emerald-400 font-semibold">Zero Delivery Fee</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3.5">
      {/* Pickup Mode Switcher (hidden in Return-Only step) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!isReturnOnly ? (
          <div className="inline-flex flex-wrap p-1 bg-obsidian border border-white/15 rounded-xl">
            <button
              type="button"
              onClick={() => handleModeChange('delivery')}
              disabled={!vehicle.deliveryEligible}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 ${
                value.pickupMode === 'delivery'
                  ? 'bg-gold text-obsidian'
                  : 'text-ivory/70 hover:text-white'
              }`}
            >
              Custom Pickup / Delivery
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('branch')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                value.pickupMode === 'branch'
                  ? 'bg-gold text-obsidian'
                  : 'text-ivory/70 hover:text-white'
              }`}
            >
              Self Pickup ({hubName} — Free)
            </button>
          </div>
        ) : (
          <div className="text-xs font-semibold text-gold">
            Choose Drop / Return Location on Map
          </div>
        )}

        <button
          type="button"
          onClick={() => setFullScreenMobile((prev) => !prev)}
          className="lg:hidden inline-flex items-center gap-1.5 text-xs font-semibold text-ivory border border-white/15 px-3 py-1.5 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
        >
          {fullScreenMobile ? (
            <Minimize2 className="w-3.5 h-3.5 text-gold" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5 text-gold" />
          )}
          {fullScreenMobile ? 'Close Map' : 'Expand Map'}
        </button>
      </div>

      {/* Render Branch Switcher ONLY when activeBranches.length > 1 */}
      {!isReturnOnly && hasBranches && activeBranches.length > 1 && (
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

      {/* Combined mode Pickup vs Return toggle tabs */}
      {mode === 'combined' && value.pickupMode === 'delivery' && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-obsidian/70 border border-white/10">
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
          <label className="inline-flex items-center gap-1.5 text-xs text-ivory cursor-pointer">
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
                    isOneWay: false,
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
      )}

      {mapSurface}

      {/* Confirmed Selection Summary */}
      <div className={`grid ${isPickupOnly || isReturnOnly ? 'grid-cols-1' : 'sm:grid-cols-2'} gap-2.5`}>
        {!isReturnOnly && (
          <div className="p-3 rounded-xl border border-white/10 bg-obsidian/60">
            <p className="text-[11px] font-semibold text-ivory/55">Confirmed Pickup Location</p>
            <p className="text-xs font-semibold text-white mt-1 leading-relaxed">
              {value.pickupAddress || 'No pickup address confirmed yet'}
            </p>
            {value.pickupMode === 'delivery' && value.distanceKm !== undefined && (
              <p className="text-[11px] font-mono tabular-nums text-gold mt-1">
                {value.distanceKm} km from {hubName}
              </p>
            )}
          </div>
        )}

        {!isPickupOnly && (
          <div className="p-3 rounded-xl border border-white/10 bg-obsidian/60">
            <p className="text-[11px] font-semibold text-ivory/55">Confirmed Return Location</p>
            <p className="text-xs font-semibold text-white mt-1 leading-relaxed">
              {value.returnAddress || value.pickupAddress || 'Not selected yet'}
            </p>
            <p className="text-[11px] text-ivory/55 mt-1">
              Coverage zone: {operatingCity || hubName} ({hubRadiusKm} km radius)
            </p>
          </div>
        )}
      </div>

      {/* Honest Serviceability Banner */}
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
              <span>Checking service coverage and applicable fees...</span>
            ) : value.serviceable ? (
              <span className="font-medium">
                {operatingCity || hubName} zone verified ·{' '}
                {value.pickupMode === 'delivery'
                  ? `Delivery fee ${formatINR(value.deliveryCharge)}`
                  : 'Free hub self-pickup'}
                {value.oneWayCharge > 0 ? ` · Return fee ${formatINR(value.oneWayCharge)}` : ''}
              </span>
            ) : (
              <span className="font-medium">
                {value.serviceReason || 'Selected location is currently outside our delivery radius.'}
              </span>
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
