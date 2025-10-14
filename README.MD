# WorkerAIChatBot Deployment Instructions

This guide provides step-by-step instructions to deploy the WorkerAIChatBot backend on Cloudflare Workers and the Angular frontend locally.

## Prerequisites

- Node.js and npm installed
- A Cloudflare account with Workers access
- Git installed

## Deploying the WorkerAIChatBot Backend on Cloudflare Workers

1. **Navigate to the WorkerAI directory**:

   ```bash
   cd WorkerAI/
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Deploy to Cloudflare Workers**:

   ```bash
   npm run deploy
   ```

   - The first time you run this command, you will be prompted to log in to Cloudflare and authorize Wrangler, the Cloudflare Workers CLI tool.
   - Upon successful authorization, Wrangler will build the project and deploy it to Cloudflare's edge network, providing a URL (e.g., `https://workerai.<your-account>.workers.dev`) for your deployed Worker.

## Running the Angular Frontend Locally

1. **Clone the repository**:

git clone https://github.com/brunocotrim1/cf_ai_ChatBotWorkers.git
cd ChatAppAngular/

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Configure the Worker URL**:

   - Open `./src/app/environments/environment.ts`.
   - Update the `apiURL` field with the URL of your deployed Cloudflare Worker (e.g., `https://workerai.bruno-cotrim1.workers.dev`).

3. **Run the Angular application**:

   ```bash
   npm run start
   ```

   - This will start the Angular development server, and the application will be accessible at `http://localhost:4200`.

## Using the ChatBot

- Open the application in your browser at `http://localhost:4200`.
- Enter your name to create and connect to a personal chat session.
- Start interacting with the WorkerAIChatBot!

## Notes

- Ensure your Cloudflare Worker is deployed and running before starting the Angular frontend.
- For production deployment of the Angular frontend, consider hosting it on a static hosting service and updating the `apiURL` accordingly.
