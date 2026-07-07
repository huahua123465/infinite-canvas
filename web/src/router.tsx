import { lazy, Suspense } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";

import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import VideoPage from "@/pages/video";

const DirectorDeskPage = lazy(() => import("@/pages/director-desk"));

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
        ],
    },
    {
        path: "/director-desk",
        element: (
            <Suspense fallback={<main className="flex h-dvh items-center justify-center bg-black text-sm text-white">正在打开 3D 导演台...</main>}>
                <DirectorDeskPage />
            </Suspense>
        ),
    },
    { path: "*", element: <NotFound /> },
]);
