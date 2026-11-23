import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { Spot } from './types';
import { wgs84ToGcj02 } from './gcj02';

/**
 * Beijing tour map for the Listening screen. Gaode raster tiles (fast inside
 * mainland China, no API key) drawn in GCJ-02; all inputs (Wikipedia spot
 * coords, device GPS) are WGS-84 and get shifted per-pin.
 */

// AutoNavi raster tiles: {s} cycles webrd01-04 for parallel loading.
const TILE_URL = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';
const TILE_SUBDOMAINS = '1234';

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
): TourMapHandle {
  const map = L.map(container, {
    zoomControl: true,
    attributionControl: false,
  }).setView([39.909, 116.391], 12); // central Beijing until markers define bounds

  L.tileLayer(TILE_URL, { subdomains: TILE_SUBDOMAINS, maxZoom: 18 }).addTo(map);

  // Spot pins — fence-centroid coords, converted to GCJ-02 so they sit on the
  // right buildings (same coords the geofence uses).
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
    marker.bindTooltip(spot.name, { direction: 'top' });
    marker.on('click', () => onSpotClick(spot));
    bounds.extend([glat, glng]);
  }
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.15));

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
      } else {
        userDot.setLatLng([glat, glng]);
      }
    },
    destroy() {
      map.remove();
    },
  };
}
