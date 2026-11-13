import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  Circle,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { LocateFixed, MapPin, Maximize2, Minimize2, Search, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { apiFetch, formatINR } from '../lib/api';
import type { Branch, PickupMode, SavedAddress, Vehicle } from '../types';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

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
}

interface LocationMapPickerProps {
  vehicle: Vehicle;
  branches: Branch[];
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
          if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT') || msg.includes('429')) {
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

const MapViewportController: React.FC<{ center: { lat: number; lng: number }; zoom?: number }> = ({
  center,
  zoom = 13,
}) => {
  const map = useMap();
  useEffect(() => {
    if (map) {
      map.panTo(center);
      map.setZoom(zoom);
    }
  }, [map, center.lat, center.lng, zoom]);
  return null;
};

const InnerMapWidget: React.FC<LocationMapPickerProps> = ({
  vehicle,
  branches,
  savedAddresses = [],
  value,
  onChange,
}) => {
  const [searchText, setSearchText] = useState('');
  const [validating, setValidating] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [fullScreenMobile, setFullScreenMobile] = useState(false);
  const [activeBranchInfo, setActiveBranchInfo] = useState<Branch | null>(null);

  const pickupBranch = branches.find((b) => b.id === value.pickupBranchId) || branches[0];
  const returnBranch = branches.find((b) => b.id === value.returnBranchId) || pickupBranch;

  const { suggestions, loading: searchLoading, resetSession, placesLib } = useAutocompleteSuggestions(searchText, {
    lat: pickupBranch?.lat || 19.076,
    lng: pickupBranch?.lng || 72.8777,
  });

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
        }>('/api/locations/validate', {
          method: 'POST',
          body: JSON.stringify({
            vehicleId: vehicle.id,
            pickupMode: draft.pickupMode,
            pickupLat: draft.pickupLat,
            pickupLng: draft.pickupLng,
            returnLat: draft.returnLat,
            returnLng: draft.returnLng,
            pickupBranchId: draft.pickupBranchId,
            returnBranchId: draft.returnBranchId,
            isOneWay: draft.isOneWay,
          }),
        });

        onChange({
          ...draft,
          serviceable: res.serviceable,
          serviceReason: res.reason,
          distanceKm: res.distanceKm,
          deliveryCharge: res.deliveryCharge || 0,
          oneWayCharge: res.oneWayCharge || 0,
        });
      } catch (err: any) {
        onChange({
          ...draft,
          serviceable: false,
          serviceReason: err.message || 'Unable to verify coverage.',
        });
      } finally {
        setValidating(false);
      }
    },
    [vehicle.id, onChange]
  );

  const reverseGeocodeCoords = useCallback(
    async (lat: number, lng: number) => {
      try {
        const geo = await apiFetch<{ formattedAddress: string }>(
          `/api/maps/reverse-geocode?lat=${lat}&lng=${lng}`
        );
        return geo.formattedAddress;
      } catch {
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      }
    },
    []
  );

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
        const address = place.formattedAddress || place.displayName || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        await validateAndSync({
          ...value,
          pickupMode: 'delivery',
          pickupAddress: address,
          pickupLat: lat,
          pickupLng: lng,
        });
      }
    } catch (err) {
      console.error('Place fetchFields error:', err);
      const msg = String(err);
      if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
    }
  };

  const handleMarkerDragEnd = async (e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    const resolvedAddress = await reverseGeocodeCoords(lat, lng);
    await validateAndSync({
      ...value,
      pickupMode: 'delivery',
      pickupAddress: resolvedAddress,
      pickupLat: lat,
      pickupLng: lng,
    });
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const resolvedAddress = await reverseGeocodeCoords(lat, lng);
        await validateAndSync({
          ...value,
          pickupMode: 'delivery',
          pickupAddress: resolvedAddress,
          pickupLat: lat,
          pickupLng: lng,
        });
        setGpsLoading(false);
      },
      () => {
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleModeChange = (mode: PickupMode) => {
    if (!pickupBranch) return;
    if (mode === 'branch') {
      void validateAndSync({
        ...value,
        pickupMode: 'branch',
        pickupAddress: pickupBranch.address,
        pickupLat: pickupBranch.lat,
        pickupLng: pickupBranch.lng,
      });
    } else {
      void validateAndSync({
        ...value,
        pickupMode: 'delivery',
      });
    }
  };

  const handleReturnBranchChange = (branchId: string) => {
    const nextReturn = branches.find((b) => b.id === branchId) || pickupBranch;
    if (!nextReturn) return;
    void validateAndSync({
      ...value,
      returnBranchId: nextReturn.id,
      isOneWay: nextReturn.id !== value.pickupBranchId,
      returnAddress: nextReturn.address,
      returnLat: nextReturn.lat,
      returnLng: nextReturn.lng,
    });
  };

  const mapCenter =
    value.pickupMode === 'delivery'
      ? { lat: value.pickupLat, lng: value.pickupLng }
      : { lat: pickupBranch?.lat || 19.076, lng: pickupBranch?.lng || 72.8777 };

  return (
    <div className="space-y-4">
      {/* Pickup Mode Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 bg-alabaster border border-black/10 rounded-lg">
          <button
            type="button"
            onClick={() => handleModeChange('branch')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              value.pickupMode === 'branch' ? 'bg-obsidian text-white' : 'text-slate-muted hover:text-ink'
            }`}
          >
            Branch Pickup (Free)
          </button>
          <button
            type="button"
            disabled={!vehicle.deliveryEligible}
            onClick={() => handleModeChange('delivery')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 ${
              value.pickupMode === 'delivery' ? 'bg-obsidian text-white' : 'text-slate-muted hover:text-ink'
            }`}
          >
            Doorstep Delivery
          </button>
        </div>

        <button
          type="button"
          onClick={() => setFullScreenMobile((prev) => !prev)}
          className="md:hidden inline-flex items-center gap-1.5 text-xs font-semibold text-ink border border-black/15 px-3 py-1.5 rounded-md"
        >
          {fullScreenMobile ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          {fullScreenMobile ? 'Close Map' : 'Expand Map'}
        </button>
      </div>

      {/* Delivery Address Search & One-Time GPS */}
      {value.pickupMode === 'delivery' && (
        <div className="space-y-2.5">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search street, landmark, or area in India..."
                className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-black/15 rounded-lg focus:outline-none focus:border-gold"
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

            <button
              type="button"
              onClick={handleUseCurrentLocation}
              disabled={gpsLoading}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold border border-black/15 rounded-lg bg-alabaster hover:border-gold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LocateFixed className="w-4 h-4 text-gold-hover" />
              {gpsLoading ? 'Locating...' : 'Use Current GPS'}
            </button>
          </div>

          <p className="text-[11px] text-slate-muted">
            One-time GPS lookup runs only when clicked. Drag the gold pin on the map to fine-tune your delivery spot.
          </p>

          {savedAddresses.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {savedAddresses.map((addr) => (
                <button
                  key={addr.id}
                  type="button"
                  onClick={() =>
                    void validateAndSync({
                      ...value,
                      pickupMode: 'delivery',
                      pickupAddress: addr.address,
                      pickupLat: addr.lat,
                      pickupLng: addr.lng,
                    })
                  }
                  className="text-xs px-2.5 py-1 border border-black/15 rounded-md bg-white hover:border-gold transition-colors cursor-pointer"
                >
                  {addr.label}: {addr.cityName}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Map Viewport */}
      <div
        className={
          fullScreenMobile
            ? 'fixed inset-0 z-50 bg-obsidian flex flex-col'
            : 'relative rounded-xl overflow-hidden border border-black/15 h-[320px] sm:h-[360px] w-full bg-alabaster'
        }
      >
        {fullScreenMobile && (
          <div className="p-3 bg-obsidian text-white flex items-center justify-between border-b border-white/10">
            <span className="text-xs font-semibold">Drag Pin to Confirm Location</span>
            <button
              type="button"
              onClick={() => setFullScreenMobile(false)}
              className="px-3 py-1 bg-gold text-obsidian text-xs font-semibold rounded-md"
            >
              Done
            </button>
          </div>
        )}

        <div className="flex-1 w-full h-full">
          {MAPS_API_KEY ? (
            <GoogleMap
              mapId="DEMO_MAP_ID"
              defaultCenter={mapCenter}
              defaultZoom={13}
              gestureHandling="greedy"
              disableDefaultUI={false}
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              style={{ width: '100%', height: '100%' }}
            >
              <MapViewportController center={mapCenter} zoom={value.pickupMode === 'delivery' ? 13 : 12} />

              {/* Delivery Radius Circle around Pickup Branch */}
              {pickupBranch && (
                <Circle
                  center={{ lat: pickupBranch.lat, lng: pickupBranch.lng }}
                  radius={pickupBranch.deliveryRadiusKm * 1000}
                  strokeColor="#C8A24D"
                  strokeOpacity={0.75}
                  strokeWeight={2}
                  fillColor="#C8A24D"
                  fillOpacity={0.08}
                />
              )}

              {/* Branch Hub Markers */}
              {branches
                .filter((b) => b.active)
                .map((b) => (
                  <AdvancedMarker
                    key={b.id}
                    position={{ lat: b.lat, lng: b.lng }}
                    title={b.name}
                    onClick={() => setActiveBranchInfo(b)}
                  >
                    <Pin background="#0B0B0D" borderColor="#C8A24D" glyphColor="#C8A24D" />
                  </AdvancedMarker>
                ))}

              {/* Selected Customer Delivery Pin (Draggable) */}
              {value.pickupMode === 'delivery' && (
                <AdvancedMarker
                  position={{ lat: value.pickupLat, lng: value.pickupLng }}
                  draggable
                  onDragEnd={(e) => void handleMarkerDragEnd(e)}
                  title="Drag to set delivery spot"
                >
                  <Pin background="#C8A24D" borderColor="#0B0B0D" glyphColor="#0B0B0D" />
                </AdvancedMarker>
              )}

              {activeBranchInfo && (
                <InfoWindow
                  position={{ lat: activeBranchInfo.lat, lng: activeBranchInfo.lng }}
                  onCloseClick={() => setActiveBranchInfo(null)}
                >
                  <div className="p-1 max-w-[200px] text-ink">
                    <p className="font-semibold text-xs">{activeBranchInfo.name}</p>
                    <p className="text-[11px] text-slate-600 mt-0.5">{activeBranchInfo.address}</p>
                    <p className="text-[11px] mt-1 font-mono">
                      Delivery radius: {activeBranchInfo.deliveryRadiusKm} km
                    </p>
                  </div>
                </InfoWindow>
              )}
            </GoogleMap>
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center p-6 text-center bg-alabaster">
              <MapPin className="w-7 h-7 text-gold mb-2" />
              <p className="text-sm font-semibold text-ink">Interactive Map Ready After Key Activation</p>
              <p className="text-xs text-slate-muted mt-1 max-w-sm">
                Branch coordinate validation remains active: {pickupBranch?.name} ({pickupBranch?.deliveryRadiusKm} km radius).
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Confirmed Address + One-Way Return Branch Selector */}
      <div className="grid sm:grid-cols-2 gap-3 pt-1">
        <div className="p-3 rounded-lg border border-black/10 bg-alabaster">
          <p className="text-[11px] font-semibold text-slate-muted">Confirmed Pickup Location</p>
          <p className="text-xs font-semibold text-ink mt-1 leading-relaxed">{value.pickupAddress}</p>
          {value.pickupMode === 'delivery' && value.distanceKm !== undefined && (
            <p className="text-[11px] font-mono tabular-nums text-slate-muted mt-1">
              {value.distanceKm} km from {pickupBranch?.name}
            </p>
          )}
        </div>

        <div className="p-3 rounded-lg border border-black/10 bg-alabaster">
          <label className="block text-[11px] font-semibold text-slate-muted mb-1">
            Return Branch {vehicle.oneWayEligible ? '(One-Way Eligible)' : '(Same Branch Return)'}
          </label>
          <select
            value={value.returnBranchId}
            disabled={!vehicle.oneWayEligible}
            onChange={(e) => handleReturnBranchChange(e.target.value)}
            className="w-full text-xs font-medium bg-white border border-black/15 rounded-md px-2.5 py-2 focus:outline-none focus:border-gold disabled:opacity-60"
          >
            {branches
              .filter((b) => b.active && (vehicle.oneWayEligible ? b.oneWaySupported || b.id === pickupBranch?.id : b.id === pickupBranch?.id))
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.cityName})
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* Backend Serviceability Status */}
      <div
        className={`p-3 rounded-lg border flex items-start gap-2.5 text-xs ${
          validating
            ? 'border-black/10 bg-alabaster text-slate-muted'
            : value.serviceable
              ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
              : 'border-red-200 bg-red-50 text-red-950'
        }`}
      >
        {value.serviceable ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
        )}
        <div className="flex-1">
          {validating ? (
            <span>Validating city, branch coverage, and delivery charges...</span>
          ) : value.serviceable ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                Serviceable area verified
                {value.pickupMode === 'delivery' ? ` · Delivery fee ${formatINR(value.deliveryCharge)}` : ' · Free branch pickup'}
                {value.oneWayCharge > 0 ? ` · One-way fee ${formatINR(value.oneWayCharge)}` : ''}
              </span>
            </div>
          ) : (
            <span className="font-medium">{value.serviceReason}</span>
          )}
        </div>
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
