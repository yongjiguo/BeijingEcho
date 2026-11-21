export type DirOctant = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface SpotImage {
  url: string;
  credit: string;
}

export interface Landmark {
  name: string;
  lat: number;
  lng: number;
}

export interface Spot {
  id: string;
  name: string;
  summary: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  audio: string;
  transcript: string;
  images: SpotImage[];
  landmark: Landmark;
}

export interface WelcomeContent {
  audio: string;
  transcript: string;
}

export interface SpotsData {
  version: number;
  welcome: WelcomeContent;
  spots: Spot[];
}

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
}

export type TourState =
  | 'landing'
  | 'requesting'
  | 'welcome'
  | 'listening'
  | 'playing'
  | 'permission-denied';
