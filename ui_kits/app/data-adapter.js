// Gorgon — Data Adapter (PHASE 10).
//
// Tiny bridge between the data pipeline and the demo app:
//   - window.GORGON_GENERATED_DATA exists and is a non-empty array
//       -> use pipeline output as the activity list.
//   - otherwise -> keep data.js DEMO DATA untouched (fallback).
//
// data.js is NEVER overwritten. If the pipeline output is missing, empty or
// broken, the demo keeps working exactly as before.

(function () {
  var gen = window.GORGON_GENERATED_DATA;
  if (!Array.isArray(gen) || gen.length === 0) return; // fallback: data.js
  var data = window.GORGON_DATA;
  if (!data || typeof data !== "object") return;       // data.js missing? do nothing

  data.activities = gen;
  data.generatedFromPipeline = true;
})();
