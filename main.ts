import { Plugin, MarkdownPostProcessorContext } from 'obsidian';
import * as Plot from '@observablehq/plot';
import * as d3 from 'd3';

interface PlotConfig {
    data: any[];
    code?: string;
}

export default class ObservablePlotPlugin extends Plugin {
    private logMessage(message: string, isError = false) {
        const prefix = '[Observable Plot]';
        if (isError) {
            console.error(prefix, message);
        } else {
            console.log(prefix, message);
        }
    }

    async onload() {
        this.logMessage('Loading plugin');

        // Register the plot code block processor
        this.registerMarkdownCodeBlockProcessor('plot', async (source, el, ctx) => {
            try {
                // First, try to parse the entire content as a single line
                // If that fails, try to parse it as a formatted JSON
                let config: PlotConfig;
                try {
                    config = JSON.parse(source);
                } catch (e) {
                    // If initial parse fails, try to handle formatted JSON
                    // This regex matches a JSON string but preserves newlines in the code property
                    const codeMatch = source.match(/("code"\s*:\s*")(.*?)("(?=\s*[}\],]))/s);
                    if (codeMatch) {
                        // Temporarily replace the code section with a placeholder
                        const placeholder = "__CODE_PLACEHOLDER__";
                        const withoutCode = source.replace(codeMatch[0], `"code":"${placeholder}"`);
                        
                        try {
                            // Parse the JSON without the actual code
                            config = JSON.parse(withoutCode);
                            // Replace the placeholder with the actual code
                            const actualCode = codeMatch[2]
                                .replace(/\\n/g, '\n')  // Handle explicit newlines
                                .replace(/\\"/g, '"')   // Handle escaped quotes
                                .replace(/\\/g, '');    // Remove remaining escapes
                            config.code = actualCode;
                        } catch (e) {
                            throw new Error("Failed to parse JSON: " + e.message);
                        }
                    } else {
                        throw new Error("Failed to parse JSON and couldn't find code section");
                    }
                }
                
                // Create a container for the plot
                const plotContainer = el.createDiv({ cls: 'observable-plot-container' });
                
                // Create an SVG element for the plot
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                plotContainer.appendChild(svg);
                
                // Create the plot
                if (config.code) {
                    // Create a function that wraps the user's code
                    const plotFunction = new Function('Plot', 'd3', 'data', 'svg', 'log', `
                        try {
                            log("Creating user function with code:\\n" + \`${config.code}\`);
                            
                            // Execute the user's code and get the plot specification
                            const userFunction = new Function('Plot', 'd3', 'data', \`
                                try {
                                    ${config.code}
                                } catch (e) {
                                    log("Error in user code: " + e.message);
                                    throw e;
                                }
                            \`);
                            
                            log("Executing user function...");
                            const spec = userFunction(Plot, d3, data);
                            log("User function result: " + JSON.stringify(spec));
                            
                            if (!spec) {
                                throw new Error('No plot specification returned. Make sure your code returns a plot specification object.');
                            }
                            
                            log("Plot spec: " + JSON.stringify(spec, null, 2));

                            // Create and render the plot
                            const plot = Plot.plot(spec);
                            log("Created plot: " + plot.outerHTML.substring(0, 100) + "...");
                            
                            if (plot && plot instanceof SVGElement) {
                                // Copy attributes and content from the created plot to our SVG
                                Array.from(plot.attributes).forEach(attr => {
                                    svg.setAttribute(attr.name, attr.value);
                                });
                                svg.innerHTML = plot.innerHTML;
                            } else {
                                throw new Error('Plot.plot() did not return an SVG element');
                            }
                        } catch (error) {
                            throw error;
                        }
                    `);
                    
                    // Execute the function with Plot library, D3, data, SVG element, and logging function
                    plotFunction(Plot, d3, config.data, svg, (msg: string) => this.logMessage(msg));
                } else {
                    // Default plot if no code is provided
                    const plot = Plot.plot({
                        marks: [Plot.dot(config.data)]
                    });
                    if (plot && plot instanceof SVGElement) {
                        // Copy attributes and content from the created plot to our SVG
                        Array.from(plot.attributes).forEach(attr => {
                            svg.setAttribute(attr.name, attr.value);
                        });
                        svg.innerHTML = plot.innerHTML;
                    } else {
                        throw new Error('Plot.plot() did not return an SVG element');
                    }
                }

            } catch (error) {
                this.logMessage(error.message, true);
                el.setText('Error rendering plot: ' + error.message);
            }
        });
    }

    onunload() {
        this.logMessage('Unloading plugin');
    }
}
