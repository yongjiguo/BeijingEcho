import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { Spot } from './types';
import { wgs84ToGcj02 } from './gcj02';

/**
 * Beijing tour map for the Listening screen. Gaode raster tiles (fast inside
 * mainland China, no API key) drawn in GCJ-02 with English labels; all inputs
 * (Wikipedia spot coords, device GPS) are WGS-84 and get shifted per-pin.
 */

// AutoNavi raster tiles: {s} cycles webrd01-04 for parallel loading; lang=en → English labels.
const TILE_URL = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=en&size=1&scale=1&style=8&x={x}&y={y}&z={z}';
const TILE_SUBDOMAINS = '1234';

/** Degrees spanned by an 8 km radius (used for the initial user-centered view). */
function eightKmBounds(lng: number, lat: number): L.LatLngBoundsExpression {
  const dLat = 8 / 111;
  const dLng = 8 / (111 * Math.cos((lat * Math.PI) / 180));
  return [
    [lat - dLat, lng - dLng],
    [lat + dLat, lng + dLng],
  ];
}

export interface TourMapHandle {
  /** Move/draw the blue user dot from a WGS-84 GPS fix. */
  updateUser(lat: number, lng: number): void;
  /** Release the Leaflet instance (call when leaving the tour). */
  destroy(): void;
}

export function createTourMap(
  container: HTMLElement,
  spots: Spot[],
  onSpotClick: (spot: Spot) => void,
  initialFix?: { lat: number; lng: number } | null,
): TourMapHandle {
  const map = L.map(container, {
    zoomControl: true,
    attributionControl: false,
  });

  L.tileLayer(TILE_URL, { subdomains: TILE_SUBDOMAINS, maxZoom: 18 }).addTo(map);

  // Spot pins — fence-centroid coords, converted to GCJ-02 so they sit on the
  // right buildings (same coords the geofence uses). Names float permanently.
  const bounds = L.latLngBounds([]);
  for (const spot of spots) {
    const [glng, glat] = wgs84ToGcj02(spot.lng, spot.lat);
    const marker = L.circleMarker([glat, glng], {
      radius: 7,
      color: '#8c1f28', // cinnabar, matches the app seal
      weight: 2,
      fillColor: '#c2453f',
      fillOpacity: 0.9,
    }).addTo(map);
    marker.bindTooltip(spot.name, {
      permanent: true,
      direction: 'top',
      offset: [0, -6],
      className: 'spot-tooltip',
    });
    marker.on('click', () => onSpotClick(spot));
    bounds.extend([glat, glng]);
  }

  // Initial view: user-centered ±8 km when a fix already exists (e.g. returning
  // to the listening screen mid-tour); otherwise frame all spots until the first
  // GPS fix arrives (then we re-center once, below).
  let centered = false;
  if (initialFix) {
    const [glng, glat] = wgs84ToGcj02(initialFix.lng, initialFix.lat);
    map.fitBounds(eightKmBounds(glng, glat));
    centered = true;
  } else if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.15));
  } else {
    map.setView([39.909, 116.391], 12);
  }

  // User dot (WGS-84 fix → GCJ-02), created lazily on first fix.
  let userDot: L.CircleMarker | null = null;

  return {
    updateUser(lat: number, lng: number) {
      const [glng, glat] = wgs84ToGcj02(lng, lat);
      if (!userDot) {
        userDot = L.circleMarker([glat, glng], {
          radius: 6,
          color: '#0a58ff',
          weight: 2,
          fillColor: '#3b82f6',
          fillOpacity: 1,
        }).addTo(map);
        // First fix of the session: frame the user's surroundings unless the
        // view is already user-centered. Later fixes only move the dot —
        // never fight the user's own pan/zoom.
        if (!centered) {
          map.fitBounds(eightKmBounds(glng, glat));
          centered = true;
        }
      } else {
        userDot.setLatLng([glat, glng]);
      }
    },
    destroy() {
      map.remove();
    },
  };
}
