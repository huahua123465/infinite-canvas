import { useNavigate, useSearchParams } from "react-router-dom";

import DirectorDeskApp from "@/features/director-desk/App";
import { resolveDirectorDeskReturnPath } from "@/lib/canvas/director-desk-routing";

export default function DirectorDeskPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const returnPath = resolveDirectorDeskReturnPath(searchParams.get("returnTo"), searchParams.get("canvasId"));

    return <DirectorDeskApp onClose={() => (returnPath ? navigate(returnPath) : window.history.length > 1 ? navigate(-1) : navigate("/canvas"))} />;
}
