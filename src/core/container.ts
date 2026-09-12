import { db } from "@/db";
import { bus, emit } from "./events";
import { hooks } from "./hooks";
import { queue } from "./queue";
import { config } from "./config";
import { routes, absolute } from "./routes";
import { channels, mcpTools, widgets, adminSections } from "./plugins/registry";

/**
 * Application service locator / facade (Laravel `app()` equivalent).
 * `import { app } from "@/core"` gives one typed entrypoint to every service;
 * plugins and pages can also import modules directly — the facade exists so
 * extension code has a single, stable surface.
 */
export const app = {
  config,
  routes,
  absolute,
  db,
  events: bus,
  emit,
  hooks,
  queue,
  get plugins() {
    return { channels, mcpTools, widgets, adminSections };
  },
};

export type App = typeof app;
