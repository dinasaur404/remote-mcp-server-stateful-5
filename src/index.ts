import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Define our stateful MCP agent with movie recommendation tools
export class MovieRecommenderMCP extends McpAgent {
	server = new McpServer({
		name: "Stateful Movie Recommender",
		version: "1.0.0",
	});

	// Properties for state management via DO
	private state?: DurableObjectState;
	private env?: Env;
	private preferences: {
		genres: string[];
		dislikedMovies: string[];
	} = {
		genres: [],
		dislikedMovies: []
	};

	// Constructor to enable Durable Object state handling
	constructor(state?: DurableObjectState, env?: Env) {
		super();
		if (state && env) {
			this.state = state;
			this.env = env;
			// Initialize state from storage
			this.initState();
		}
	}

	// Load state from Durable Object storage
	async initState() {
		if (this.state) {
			this.preferences = await this.state.storage.get("preferences") || {
				genres: [],
				dislikedMovies: []
			};
		}
	}

	async init() {
		// Movie recommendation tool
		this.server.tool(
			"recommendMovies",
			{ 
				query: z.string()
			},
			async ({ query }) => {
				// Update preferences based on the query
				await this.updatePreferences(query);
				
				// Generate recommendations based on preferences
				const recommendations = this.getRecommendations();
				
				// Create personalized response
				let responseText = `Based on your request "${query}"`;
				
				if (this.preferences.genres.length > 0) {
					responseText += ` and your interest in ${this.preferences.genres.join(", ")}`;
				}
				
				responseText += `, here are some recommendations:\n\n`;
				recommendations.forEach((movie, index) => {
					responseText += `${index + 1}. ${movie}\n`;
				});
				
				if (this.preferences.dislikedMovies.length > 0) {
					responseText += `\n(I've excluded movies you didn't enjoy: ${this.preferences.dislikedMovies.join(", ")})`;
				}
				
				return {
					content: [{ type: "text", text: responseText }],
				};
			}
		);

		// Feedback tool to track liked/disliked movies
		this.server.tool(
			"movieFeedback",
			{
				movie: z.string(),
				liked: z.boolean()
			},
			async ({ movie, liked }) => {
				if (!liked) {
					// Add to disliked movies if not already there
					const movieLower = movie.toLowerCase();
					if (!this.preferences.dislikedMovies.includes(movieLower)) {
						this.preferences.dislikedMovies.push(movieLower);
						// Save updated preferences
						if (this.state) {
							await this.state.storage.put("preferences", this.preferences);
						}
					}
				}
				
				return {
					content: [{ 
						type: "text", 
						text: liked 
							? `Great! I'll recommend more movies like "${movie}" in the future.` 
							: `I've noted that you didn't enjoy "${movie}". I'll avoid recommending similar movies.`
					}],
				};
			}
		);
	}
	
	// Extract and update preferences from the query
	async updatePreferences(query: string) {
		const lowerQuery = query.toLowerCase();
		
		// Extract genres
		const genres = [
			"action", "comedy", "drama", "sci-fi", "horror"
		];
		
		let preferencesUpdated = false;
		
		genres.forEach(genre => {
			if (lowerQuery.includes(genre) && !this.preferences.genres.includes(genre)) {
				this.preferences.genres.push(genre);
				preferencesUpdated = true;
			}
		});
		
		// Extract disliked movies
		if (lowerQuery.includes("don't like") || lowerQuery.includes("didn't enjoy") || 
				lowerQuery.includes("dislike") || lowerQuery.includes("hate")) {
			
			const movies = [
				"godfather", "star wars", "inception", "avengers", 
				"titanic", "matrix"
			];
			
			movies.forEach(movie => {
				if (lowerQuery.includes(movie) && !this.preferences.dislikedMovies.includes(movie)) {
					this.preferences.dislikedMovies.push(movie);
					preferencesUpdated = true;
				}
			});
		}
		
		// Save updated preferences to Durable Object storage
		if (preferencesUpdated && this.state) {
			await this.state.storage.put("preferences", this.preferences);
		}
	}
	
	// Generate movie recommendations based on preferences
	getRecommendations() {
		// Movie lists by genre
		const moviesByGenre: {[key: string]: string[]} = {
			"action": ["Die Hard", "The Dark Knight", "John Wick", "Mission Impossible"],
			"comedy": ["Superbad", "Bridesmaids", "The Hangover", "Booksmart"],
			"drama": ["The Godfather", "The Shawshank Redemption", "Forrest Gump", "The Social Network"],
			"sci-fi": ["The Matrix", "Inception", "Interstellar", "Blade Runner 2049"],
			"horror": ["The Shining", "Get Out", "Hereditary", "A Quiet Place"]
		};
		
		let recommendations: string[] = [];
		
		// Add movies based on preferred genres
		if (this.preferences.genres.length > 0) {
			this.preferences.genres.forEach(genre => {
				if (moviesByGenre[genre]) {
					recommendations = recommendations.concat(moviesByGenre[genre]);
				}
			});
		} else {
			// Default recommendations if no preferences yet
			recommendations = [
				"The Shawshank Redemption",
				"The Godfather", 
				"Inception", 
				"Parasite",
				"The Dark Knight"
			];
		}
		
		// Filter out disliked movies
		recommendations = recommendations.filter(movie => 
			!this.preferences.dislikedMovies.some(disliked => 
				movie.toLowerCase().includes(disliked)
			)
		);
		
		// Return 5 unique recommendations
		return [...new Set(recommendations)].slice(0, 5);
	}
}

// Durable Object for state management
export class MovieRecommenderState {
	private state: DurableObjectState;
	private env: Env;
	private mcp: MovieRecommenderMCP;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
		this.mcp = new MovieRecommenderMCP(state, env);
	}
	
	async fetch(request: Request) {
		const url = new URL(request.url);
		
		if (url.pathname === "/mcp") {
			return this.mcp.serve("/mcp").fetch(request, this.env, null);
		}
		
		return new Response("Not found", { status: 404 });
	}
}

// Define the Env interface to include our Durable Object
interface Env {
	MovieRecommenderState: DurableObjectNamespace;
	// Add other environment bindings as needed
}

// Worker script that routes requests to appropriate handlers
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		
		// Get or create session ID
		let sessionId = url.searchParams.get("sessionId");
		if (!sessionId) {
			sessionId = crypto.randomUUID();
		}
		
		// Routes for stateless version (demo purposes)
		if (url.pathname === "/stateless/mcp") {
			// Create a new instance without state for each request
			const statelessMCP = new MovieRecommenderMCP();
			return statelessMCP.serve("/stateless/mcp").fetch(request, env, ctx);
		}
		
		// Routes for stateful version using Durable Objects
		if (url.pathname === "/mcp") {
			// Get Durable Object stub using sessionId
			const id = env.MovieRecommenderState.idFromString(sessionId);
			const stub = env.MovieRecommenderState.get(id);
			
			// Forward request to Durable Object
			const response = await stub.fetch(request);
			const responseData = await response.json();
			
			// Return response with session ID included for client reference
			return new Response(JSON.stringify({
				sessionId,
				...responseData
			}), {
				headers: { "Content-Type": "application/json" }
			});
		}
		
		// Simple HTML UI for demo purposes
		if (url.pathname === "/" || url.pathname === "") {
			return new Response(`
				<!DOCTYPE html>
				<html>
				<head>
					<title>CloudFlare Stateful MCP Demo</title>
					<style>
						body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
						.container { display: flex; gap: 20px; }
						.panel { flex: 1; padding: 15px; border: 1px solid #ccc; border-radius: 5px; }
						button { padding: 8px 16px; background: #0051c3; color: white; border: none; border-radius: 5px; cursor: pointer; }
						input, textarea { width: 100%; padding: 8px; margin-bottom: 10px; box-sizing: border-box; }
						h2 { color: #0051c3; }
						.response { white-space: pre-wrap; background: #f5f5f5; padding: 10px; border-radius: 5px; }
					</style>
				</head>
				<body>
					<h1>CloudFlare Stateful MCP Demo</h1>
					<div class="container">
						<div class="panel">
							<h2>Stateless MCP</h2>
							<input type="text" id="statelessInput" placeholder="e.g., 'I need a movie recommendation'">
							<button onclick="sendStateless()">Send</button>
							<div id="statelessResponse" class="response"></div>
						</div>
						<div class="panel">
							<h2>Stateful MCP</h2>
							<input type="text" id="statefulInput" placeholder="e.g., 'I need a movie recommendation'">
							<button onclick="sendStateful()">Send</button>
							<div id="statefulResponse" class="response"></div>
							<div id="sessionId" style="margin-top: 10px; font-size: 12px;"></div>
						</div>
					</div>
					<script>
						let currentSessionId = "";
						
						async function sendStateless() {
							const input = document.getElementById('statelessInput').value;
							const response = document.getElementById('statelessResponse');
							response.innerText = "Loading...";
							
							try {
								const result = await fetch('/stateless/mcp', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ message: input })
								});
								const data = await result.json();
								response.innerText = data.content[0].text;
								document.getElementById('statelessInput').value = "";
							} catch (error) {
								response.innerText = "Error: " + error.message;
							}
						}
						
						async function sendStateful() {
							const input = document.getElementById('statefulInput').value;
							const response = document.getElementById('statefulResponse');
							response.innerText = "Loading...";
							
							try {
								const url = currentSessionId 
									? '/mcp?sessionId=' + currentSessionId 
									: '/mcp';
									
								const result = await fetch(url, {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ message: input })
								});
								const data = await result.json();
								response.innerText = data.content[0].text;
								
								if (data.sessionId) {
									currentSessionId = data.sessionId;
									document.getElementById('sessionId').innerText = "Session ID: " + currentSessionId;
								}
								
								document.getElementById('statefulInput').value = "";
							} catch (error) {
								response.innerText = "Error: " + error.message;
							}
						}
					</script>
				</body>
				</html>
			`, {
				headers: { "Content-Type": "text/html" }
			});
		}
		
		// Default response with session ID information
		return new Response(JSON.stringify({ 
			sessionId,
			message: "Use this sessionId parameter with your requests to maintain state" 
		}), {
			headers: { "Content-Type": "application/json" }
		});
	},
};
