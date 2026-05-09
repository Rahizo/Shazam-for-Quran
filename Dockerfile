FROM node:22-bookworm

WORKDIR /app

ENV SERVE_WEB_DIST=true
ENV PYTHONUNBUFFERED=1
ENV PYTHONIOENCODING=utf-8

ARG EXPO_PUBLIC_API_BASE_URL=
ENV EXPO_PUBLIC_API_BASE_URL=$EXPO_PUBLIC_API_BASE_URL

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --include=dev
RUN python3 -m pip install --break-system-packages --no-cache-dir faster-whisper

COPY . .

RUN npm run download:quran
RUN npm run build:web

ENV NODE_ENV=production

EXPOSE 8787

CMD ["npm", "run", "start:prod"]
