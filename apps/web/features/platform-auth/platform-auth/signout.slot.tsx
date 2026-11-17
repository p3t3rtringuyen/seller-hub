import { SignOut } from "./SignOut";

// Slot convention: a plain module whose default export is { slot, component, order }. It must NOT be a "use client"
// file (the registry is also read by server components, where an object exported from a client module is a reference);
// the client code lives in SignOut.tsx.
export default { slot: "shell.header.actions", component: SignOut, order: 900 };
