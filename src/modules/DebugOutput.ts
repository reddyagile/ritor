// src/modules/DebugOutput.ts
import Ritor from "../Ritor";
import { ModuleOptions } from "../types";

// Minimal placeholder class for DebugOutput
class DebugOutput {
    constructor(ritor: Ritor, options: ModuleOptions) {
        console.log(
            'DebugOutput placeholder class initialized. Ritor instance:',
            ritor ? 'received' : 'not received',
            'Options:', options
        );
    }

    // Optional destroy method, common for modules
    public destroy?(): void {
        console.log('DebugOutput placeholder destroyed');
    }
}

export default DebugOutput;
