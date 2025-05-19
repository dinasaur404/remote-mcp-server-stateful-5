import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Define our MCP agent with tools
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Movie Recommender",
		version: "1.0.0",
	});
    
	// Keep track of user preferences in memory (for simplicity)
	private preferences = {
		genres: [] as string[],
		dislikedMovies: [] as string[]
	};

	async init() {
		// Original calculator tools (kept for reference)
		this.server.tool(
			"add",
			{ a: z.number(), b: z.number() },
			async ({ a, b }) => ({
				content: [{ type: "text", text: String(a + b) }],
			})
		);
		this.server.tool(
			"calculate",
			{
				operation: z.enum(["add", "subtract", "multiply", "divide"]),
				a: z.number(),
				b: z.number(),
			},
			async ({ operation, a, b }) => {
				let result: number;
				switch (operation) {
					case "add":
						result = a + b;
						break;
					case "subtract":
						result = a - b;
						break;
					case "multiply":
						result = a * b;
						break;
					case "divide":
						if (b === 0)
							return {
								content: [
									{
										type: "text",
										text: "Error: Cannot divide by zero",
									},
								],
							};
						result = a / b;
						break;
				}
				return { content: [{ type: "text", text: String(result) }] };
			}
		);

		// New movie recommendation tool
		this.server.tool(
			"recommendMovies",
			{ 
				query: z.string()
			},
			async ({ query }) => {
				// Update preferences based on the query
				this.updatePreferences(query);
				
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
	}
	
	// Extract and update preferences from the query
	updatePreferences(query: string) {
		const lowerQuery = query.toLowerCase();
		
		// Extract genres
		const genres = [
			"action", "comedy", "drama", "sci-fi", "horror"
		];
		
		genres.forEach(genre => {
			if (lowerQuery.includes(genre) && !this.preferences.genres.includes(genre)) {
				this.preferences.genres.push(genre);
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
				}
			});
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

// Keep the original worker script exactly as is
export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			// @ts-ignore
			return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
		}
		if (url.pathname === "/mcp") {
			// @ts-ignore
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}
		return new Response("Not found", { status: 404 });
	},
};

interface Env {
  MCP_OBJECT: DurableObjectNamespace;
}
