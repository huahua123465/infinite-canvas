import { create } from "zustand";

export type WorkbenchCommand = { nonce: number; prompt?: string; run: boolean };

type WorkbenchAgentStore = {
    imageCommand: WorkbenchCommand | null;
    videoCommand: WorkbenchCommand | null;
    dispatchImage: (command: Omit<WorkbenchCommand, "nonce">) => void;
    dispatchVideo: (command: Omit<WorkbenchCommand, "nonce">) => void;
    clearImageCommand: () => void;
    clearVideoCommand: () => void;
};

let nonce = 0;

export const useWorkbenchAgentStore = create<WorkbenchAgentStore>((set) => ({
    imageCommand: null,
    videoCommand: null,
    dispatchImage: (command) => set({ imageCommand: { ...command, nonce: ++nonce } }),
    dispatchVideo: (command) => set({ videoCommand: { ...command, nonce: ++nonce } }),
    clearImageCommand: () => set({ imageCommand: null }),
    clearVideoCommand: () => set({ videoCommand: null }),
}));
