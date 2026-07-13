// Module-worker smoke test: heightcore must load with zero THREE dependencies
// (import maps don't apply inside workers — bare specifiers would throw).
// new Worker('./src/workercheck.js', { type: 'module' }) from the page.
import { heightAt, surfaceAt } from './heightcore.js';
self.postMessage({ h: heightAt(1234, 5678), surf: { ...surfaceAt(1234, 5678) } });
