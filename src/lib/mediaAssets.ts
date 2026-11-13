import heroObsidianFleet from '../assets/images/hero_obsidian_fleet_1794560522725.jpg';
import carMahindraThar from '../assets/images/car_mahindra_thar_1794560523792.jpg';
import carHyundaiVerna from '../assets/images/car_hyundai_verna_1794560523510.jpg';
import carTataNexonEv from '../assets/images/car_tata_nexon_ev_1794560524286.jpg';
import carInnovaHycross from '../assets/images/car_innova_hycross_1794560524873.jpg';
import carMarutiSwift from '../assets/images/car_maruti_swift_hatchback_1794560526014.jpg';

export const HERO_BANNER_IMAGE = heroObsidianFleet;

const ASSET_MAP: Record<string, string> = {
  hero: heroObsidianFleet,
  thar: carMahindraThar,
  verna: carHyundaiVerna,
  nexon_ev: carTataNexonEv,
  hycross: carInnovaHycross,
  swift: carMarutiSwift,
};

export function resolveVehicleImage(imageKeyOrUrl?: string): string {
  if (!imageKeyOrUrl) return carHyundaiVerna;
  if (ASSET_MAP[imageKeyOrUrl]) return ASSET_MAP[imageKeyOrUrl];
  if (imageKeyOrUrl.startsWith('data:') || imageKeyOrUrl.startsWith('/') || imageKeyOrUrl.startsWith('http')) {
    return imageKeyOrUrl;
  }
  return carHyundaiVerna;
}
