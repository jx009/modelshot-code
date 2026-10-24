import { createRoot } from "react-dom/client";
import NativeOfficeArtifactEditor from "../../src/components/creation/NativeOfficeArtifactEditor";

// Real editor, formula Worker, draft/session/controller and IndexedDB. The
// browser test intercepts HTTP only; no production credentials or services.
createRoot(document.getElementById("root")).render(<NativeOfficeArtifactEditor userId="fixture-user" artifactId="fixture-sheet" kind="sheet" zh />);
