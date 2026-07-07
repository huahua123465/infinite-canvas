import { useNavigate } from "react-router-dom";

import DirectorDeskApp from "@/features/director-desk/App";

export default function DirectorDeskPage() {
    const navigate = useNavigate();

    return <DirectorDeskApp onClose={() => navigate("/canvas")} />;
}
