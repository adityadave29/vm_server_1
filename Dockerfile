# Use an official Node.js image as the base image
FROM node:16

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port your server runs on
EXPOSE 9000

# Define the command to run your server
CMD ["npm", "run","dev"]
