import { createServer } from "vite";

const server = await createServer({
  server: {
    allowedHosts: ["127.0.0.1", "localhost"],
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});

await server.listen();
server.printUrls();

setInterval(() => {}, 1000);
