# --- Build the static Vite bundle ---
FROM node:20-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
# Bake the backend's public URL into the build (set VITE_API_BASE_URL at
# build time). Falls back to a relative /api/v1 path, which only works if
# something in front of this container (e.g. nginx) proxies /api to the
# backend — on Render, where frontend and backend are separate services
# with separate URLs, set VITE_API_BASE_URL instead (see render.yaml).
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

# --- Serve the built files ---
FROM node:20-slim
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist
EXPOSE 10000
CMD ["sh", "-c", "serve -s dist -l ${PORT:-10000}"]
