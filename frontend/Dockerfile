FROM node:24-slim

WORKDIR /app

# Copy only the package files first so the slow "npm ci" step is cached
# until the dependencies change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000

# --hostname 0.0.0.0 makes the dev server reachable from outside the container.
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]
