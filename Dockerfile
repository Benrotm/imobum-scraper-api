# Use the lightweight Playwright image which includes Chromium + necessary Linux dependencies
FROM mcr.microsoft.com/playwright:v1.41.0-jammy

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

RUN npm install

# Bundle app source
COPY . .

# Expose port
EXPOSE 8080

# Command to run the application
CMD [ "node", "index.js" ]
