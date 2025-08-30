#!/usr/bin/env node
// Lightweight launcher that always runs under CommonJS, regardless of the user's Node default type.
// It delegates to the compiled CLI entry which is CommonJS.
require("../dist/index.js");

