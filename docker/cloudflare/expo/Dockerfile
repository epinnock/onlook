FROM node:20-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl && \
    rm -rf /var/lib/apt/lists/*

# Install Expo CLI globally
RUN npm install -g expo-cli@latest

# Pre-install Onlook preload script
RUN mkdir -p /opt/onlook
COPY shared/onlook-preload-script.js /opt/onlook/

# Set workspace
WORKDIR /workspace

# Expose common ports (Expo web: 8080, Metro: 8081, dev tools: 19000-19006)
EXPOSE 8080 8081 19000 19001 19002 19003 19004 19005 19006

CMD ["bash"]
