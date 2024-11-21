import { Plugin, MarkdownPostProcessorContext } from 'obsidian';
import * as Plot from '@observablehq/plot';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';

interface PlotConfig {
    data?: any[];
    dataUrl?: string;
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

                // Fetch data from URL if provided
                let plotData: any[];
                if (config.dataUrl) {
                    try {
                        this.logMessage(`Fetching data from ${config.dataUrl}`);
                        const response = await fetch(config.dataUrl);
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        
                        // Get the file extension to determine the parser
                        const url = new URL(config.dataUrl);
                        const ext = url.pathname.split('.').pop()?.toLowerCase();
                        
                        const text = await response.text();
                        switch (ext) {
                            case 'csv':
                                plotData = d3.csvParse(text, d3.autoType);
                                break;
                            case 'tsv':
                                plotData = d3.tsvParse(text, d3.autoType);
                                break;
                            case 'json':
                            case 'geojson':
                            case 'topojson':
                                const data = JSON.parse(text);
                                // If it's a TopoJSON file (check for objects property)
                                if (data.objects) {
                                    // Let the user handle the TopoJSON conversion in their code
                                    plotData = data;
                                } 
                                // If it's a GeoJSON file (check for type property)
                                else if (data.type === 'FeatureCollection' || data.type === 'Feature') {
                                    plotData = data;
                                }
                                // Regular JSON array
                                else if (Array.isArray(data)) {
                                    plotData = data;
                                }
                                // Regular JSON object
                                else {
                                    plotData = [data];
                                }
                                break;
                            default:
                                // Try to auto-detect the format
                                if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
                                    const data = JSON.parse(text);
                                    if (data.objects) {
                                        plotData = data;
                                    } else if (data.type === 'FeatureCollection' || data.type === 'Feature') {
                                        plotData = data;
                                    } else if (Array.isArray(data)) {
                                        plotData = data;
                                    } else {
                                        plotData = [data];
                                    }
                                } else if (text.includes('\t')) {
                                    plotData = d3.tsvParse(text, d3.autoType);
                                } else {
                                    plotData = d3.csvParse(text, d3.autoType);
                                }
                        }
                        
                        this.logMessage(`Successfully fetched data: ${typeof plotData === 'object' ? 'GeoJSON/TopoJSON' : plotData.length + ' items'}`);
                    } catch (error) {
                        throw new Error(`Failed to fetch data from URL: ${error.message}`);
                    }
                } else if (config.data) {
                    plotData = config.data;
                } else {
                    throw new Error('Either data or dataUrl must be provided');
                }

                // Create a container for the plot
                const plotContainer = el.createDiv({ cls: 'observable-plot-container' });

                // Create the plot
                if (config.code) {
                    // Create a function that wraps the user's code
                    const plotFunction = new Function('Plot', 'd3', 'data', 'topojson', 'container', `
                        return (async () => {
                            try {
                                // Execute the user's code and get the plot specification
                                const userFunction = new Function('Plot', 'd3', 'data', 'topojson', \`
                                    return (async () => {
                                        try {
                                            ${config.code}
                                        } catch (e) {
                                            throw e;
                                        }
                                    })();
                                \`);
                                
                                const spec = await userFunction(Plot, d3, data, topojson);
                                if (!spec) {
                                    throw new Error('No plot specification returned');
                                }
                                
                                const plot = Plot.plot(spec);
                                
                                if (!plot) {
                                    throw new Error('Plot.plot() returned null');
                                }
                                
                                // Clear the container and append the plot
                                container.empty();
                                container.appendChild(plot);
                            } catch (error) {
                                throw error;
                            }
                        })();
                    `);
                    
                    // Execute the function with Plot library, D3, data, topojson, and container element
                    plotFunction(Plot, d3, plotData, topojson, plotContainer).catch(error => {
                        console.error('Error in plot generation:', error);
                        plotContainer.setText('Error generating plot: ' + error.message);
                    });
                } else {
                    // Default plot if no code is provided
                    const plot = Plot.plot({
                        width: 640,
                        height: 400,
                        margin: 40,
                        marks: [Plot.dot(plotData)]
                    });
                    
                    if (!plot) {
                        throw new Error('Plot.plot() returned null');
                    }
                    
                    plotContainer.empty();
                    plotContainer.appendChild(plot);
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
