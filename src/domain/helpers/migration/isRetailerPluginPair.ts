import { RETAILER_PLUGIN_PAIR } from "../../constants/migration/RETAILER_PLUGIN_PAIR.js";

/** Whether `from -> to` is the retailer-plugin pair, in any case. */
export function isRetailerPluginPair(from: string, to: string): boolean {
  return from.toLowerCase() === RETAILER_PLUGIN_PAIR.from && to.toLowerCase() === RETAILER_PLUGIN_PAIR.to;
}
