import cubeSrc from "cubejs/lib/cube.js?raw";
import solveSrc from "cubejs/lib/solve.js?raw";

// cubejs ships as CoffeeScript-compiled CommonJS code that expects to run
// as a classic global <script> (relies on a sloppy-mode top-level `this`
// to hand the Cube class from cube.js over to solve.js). Under Vite's ESM
// bundling, top-level `this` is `undefined`, so solve.js's
// `this.Cube || require('./cube')` throws. Evaluate both files in an
// isolated sandbox with `this` bound explicitly to sidestep that.
const sandbox = {};
new Function(cubeSrc).call(sandbox);
new Function(solveSrc).call(sandbox);

export default sandbox.Cube;
