/**
 * Lets node run tools that import the app's TypeScript, which leaves off extensions
 * ("../map", "./maps"): those resolve to .ts, or to the folder's index.ts.
 *
 *   node --import ./tools/ts-hooks.mjs tools/<tool>.ts
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      if (!specifier.startsWith(".") || /\.[cm]?[jt]sx?$/.test(specifier)) throw e;
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        return next(`${specifier}/index.ts`, context);
      }
    }
  },
});
