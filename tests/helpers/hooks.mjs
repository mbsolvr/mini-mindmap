import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

// Unit tests control render/effect boundaries; the browser suite exercises React itself.
export function hookRuntime() {
  const slots = [];
  let cursor = 0,
    pending = [];
  const hooks = {
    useRef(value) {
      const index = cursor++;
      return (slots[index] ||= { current: value });
    },
    useState(initial) {
      const index = cursor++;
      slots[index] ||= {
        value: typeof initial === "function" ? initial() : initial,
      };
      return [
        slots[index].value,
        (value) => {
          slots[index].value =
            typeof value === "function" ? value(slots[index].value) : value;
        },
      ];
    },
    useEffect(effect, deps) {
      const index = cursor++,
        previous = slots[index];
      if (
        !previous ||
        !deps ||
        deps.some((value, i) => !Object.is(value, previous.deps[i]))
      ) {
        pending.push(() => {
          previous?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  return {
    hooks,
    render(callback, effects = true) {
      cursor = 0;
      const result = callback();
      if (effects) this.flushEffects();
      return result;
    },
    flushEffects() {
      const effects = pending;
      pending = [];
      effects.forEach((effect) => effect());
    },
    unmount() {
      slots.forEach((slot) => slot.cleanup?.());
      pending = [];
    },
  };
}

let nextModule = 0;
export async function loadHook(file, hooks, replacements = {}) {
  const source = await readFile(file, "utf8");
  const compiled = await transform(source, { loader: "ts", format: "esm" });
  const id = nextModule++;
  globalThis.__miniHookTests ||= new Map();
  globalThis.__miniHookTests.set(id, hooks);
  let code = compiled.code.replace(
    /import \{([^}]+)\} from "react";/,
    `const {$1} = globalThis.__miniHookTests.get(${id});`,
  );
  for (const [before, after] of Object.entries(replacements))
    code = code.replace(before, after);
  code = code.replace(
    /from "(\.\.?\/[^\"]+)"/g,
    (_, path) => `from ${JSON.stringify(new URL(path, file).href)}`,
  );
  try {
    return await import(
      `data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${id}`
    );
  } finally {
    globalThis.__miniHookTests.delete(id);
  }
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export const settle = () => new Promise((resolve) => setImmediate(resolve));
