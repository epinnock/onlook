FROM node:20-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl && \
    rm -rf /var/lib/apt/lists/*

# Pre-install Onlook preload script
RUN mkdir -p /opt/onlook
COPY shared/onlook-preload-script.js /opt/onlook/

# Set workspace
WORKDIR /workspace

# Expose common ports (Next.js dev: 3000)
EXPOSE 3000

CMD ["bash"]
