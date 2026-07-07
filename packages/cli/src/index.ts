#!/usr/bin/env node
import { createProgram } from "./program";
import { getVersion } from "./version";

createProgram(getVersion()).parse(process.argv);
