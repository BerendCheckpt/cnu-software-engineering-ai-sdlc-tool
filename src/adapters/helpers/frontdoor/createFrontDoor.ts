import { FrontDoor } from "../../classes/frontdoor/FrontDoor.js";
import { createApp } from "../../composition.js";
import type { App } from "../../types/composition/App.js";

/** For callers outside this package: opens the knowledge store at `AISDLC_HOME`. */
export function createFrontDoor(app: App = createApp()): FrontDoor {
  return new FrontDoor(app.lookup);
}
