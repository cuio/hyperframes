export type { AtmospherePreset, AtmosphereContext } from "./types.js";
export {
  BUILTIN_ATMOSPHERES,
  ATMOSPHERE_IDS,
  getAtmosphere,
  defaultAtmosphereForTemplate,
  renderAtmosphere,
} from "./builtin.js";
export {
  compose,
  BUILTIN_COMPOSITIONS,
  resolveAtmosphereOrComposition,
  listAllAtmosphereIds,
  type AtmosphereComposition,
} from "./compose.js";
