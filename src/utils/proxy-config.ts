export interface ProxyConfig {
  url: string;
  priority: number;
  isHealthy: boolean;
  lastCheck: number;
  requiresCredentials: boolean;
  transformRequest?: (url: string, options?: RequestInit) => { url: string; options: RequestInit };
}

// List of proxy servers in order of priority
const proxyServers: ProxyConfig[] = [
  {
    url: 'https://meetup-proxy.oneyashraj.workers.dev',
    priority: 1,
    isHealthy: true,
    lastCheck: 0,
    requiresCredentials: true,
    transformRequest: (url: string, options?: RequestInit) => {
      const baseUrl = 'https://api.meetup.com';
      const path = url.includes('/gql') ? '/gql' : url.replace(baseUrl, '');
      const finalUrl = `${proxyServers[0].url}/proxy${path}`;
      
      // For GraphQL requests
      if (url.includes('/gql')) {
        const headers = options?.headers as Record<string, string>;
        const requestHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        };

        // Add authorization if present
        if (headers?.['Authorization']) {
          requestHeaders['Authorization'] = headers['Authorization'];
        }

        // Ensure body is properly formatted
        let body = options?.body;
        if (body) {
          try {
            const parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
            // Ensure the body has the required fields
            if (!parsedBody.query) {
              throw new Error('Missing GraphQL query');
            }
            body = JSON.stringify(parsedBody);
          } catch (error) {
            console.error('Error processing GraphQL body:', error);
            throw new Error('Invalid GraphQL request body');
          }
        }

        return {
          url: finalUrl,
          options: {
            method: 'POST',
            headers: requestHeaders,
            body,
            mode: 'cors'
          }
        };
      }
      
      // For REST requests
      const requestHeaders: Record<string, string> = {
        ...(options?.headers as Record<string, string> || {}),
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Origin': 'https://yashrajnayak.github.io',
        'Referer': 'https://yashrajnayak.github.io/'
      };

      return {
        url: finalUrl,
        options: {
          ...(options || {}),
          method: options?.method || 'GET',
          headers: requestHeaders,
          credentials: 'include',
          mode: 'cors'
        }
      };
    }
  },
  {
    url: 'https://api.allorigins.win/raw',
    priority: 2,
    isHealthy: true,
    lastCheck: 0,
    requiresCredentials: false,
    transformRequest: (url: string, options?: RequestInit) => {
      const baseUrl = 'https://api.meetup.com';
      const path = url.includes('/gql') ? '/gql' : url.replace(baseUrl, '');
      const targetUrl = `${baseUrl}${path}`;
      
      // Extract authorization header
      const headers = options?.headers as Record<string, string>;
      const auth = headers?.['Authorization'];
      
      // For GraphQL endpoint
      if (url.includes('/gql')) {
        const requestHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        };

        // Process the request body
        let body = options?.body;
        if (body) {
          try {
            const parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
            // Add authorization to the body if present
            if (auth) {
              parsedBody.authorization = auth.replace('Bearer ', '');
            }
            // Ensure the body has the required fields
            if (!parsedBody.query) {
              throw new Error('Missing GraphQL query');
            }
            body = JSON.stringify(parsedBody);
          } catch (error) {
            console.error('Error processing GraphQL body:', error);
            throw new Error('Invalid GraphQL request body');
          }
        }

        return {
          url: `${proxyServers[1].url}?url=${encodeURIComponent(targetUrl)}`,
          options: {
            method: 'POST',
            headers: requestHeaders,
            body,
            mode: 'cors'
          }
        };
      }
      
      // For REST endpoints
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      };

      return { 
        url: `${proxyServers[1].url}?url=${encodeURIComponent(targetUrl)}`,
        options: {
          method: options?.method || 'GET',
          headers: requestHeaders,
          mode: 'cors'
        }
      };
    }
  }
];

const HEALTH_CHECK_INTERVAL = 60000; // 1 minute

// Check proxy health
export async function checkProxyHealth(proxy: ProxyConfig): Promise<boolean> {
  try {
    let testUrl: string;
    let headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,origin,referer',
      'Origin': 'https://yashrajnayak.github.io',
      'Referer': 'https://yashrajnayak.github.io/'
    };
    
    let options: RequestInit = {
      method: 'OPTIONS',
      headers,
      mode: 'cors',
      credentials: 'include'
    };

    if (proxy.url === 'https://api.allorigins.win/raw') {
      testUrl = `${proxy.url}?url=${encodeURIComponent('https://api.meetup.com/status')}`;
      // AllOrigins doesn't support OPTIONS, use GET instead
      options.method = 'GET';
      headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      };
      options.headers = headers;
      options.credentials = undefined;
    } else {
      testUrl = `${proxy.url}/proxy/status`;
    }

    console.log('Checking health for proxy:', proxy.url, 'with options:', options);
    const response = await fetch(testUrl, options);

    // For OPTIONS request, 204 or 200 is success
    if (options.method === 'OPTIONS' && (response.status === 204 || response.status === 200)) {
      console.log('OPTIONS request successful for proxy:', proxy.url);
      return true;
    }

    if (!response.ok) {
      console.warn(`Health check failed for proxy ${proxy.url}:`, {
        status: response.status,
        statusText: response.statusText
      });
      return false;
    }

    try {
      const contentType = response.headers.get('content-type');
      const isValidResponse = contentType?.includes('application/json') || 
                            contentType?.includes('text/plain') ||
                            contentType?.includes('text/html');

      if (!isValidResponse) {
        console.warn(`Invalid content type from proxy ${proxy.url}:`, contentType);
        return false;
      }

      const text = await response.text();
      
      // For AllOrigins, any valid response is good
      if (proxy.url === 'https://api.allorigins.win/raw') {
        return true;
      }

      // Try to parse as JSON if possible
      try {
        JSON.parse(text);
        return true;
      } catch {
        // If not JSON, check if it's a valid response
        return text.includes('status') || text.includes('ok');
      }
    } catch (parseError) {
      console.warn(`Error parsing response from proxy ${proxy.url}:`, parseError);
      return false;
    }
  } catch (error) {
    console.warn(`Health check error for proxy ${proxy.url}:`, error);
    return false;
  }
}

// Update proxy health status
export function updateProxyHealth(proxyUrl: string, isHealthy: boolean): void {
  const proxy = proxyServers.find(p => proxyUrl.startsWith(p.url));
  if (proxy) {
    proxy.isHealthy = isHealthy;
    proxy.lastCheck = Date.now();
    console.log('Updated proxy health:', {
      url: proxy.url,
      isHealthy: proxy.isHealthy,
      lastCheck: new Date(proxy.lastCheck).toISOString()
    });
  }
}

// Get the next available healthy proxy
export async function getHealthyProxy(): Promise<string | null> {
  // Update health status for all proxies
  await Promise.all(proxyServers.map(async proxy => {
    const isHealthy = await checkProxyHealth(proxy);
    updateProxyHealth(proxy.url, isHealthy);
  }));
  
  // Sort by priority and find the first healthy proxy
  const healthyProxy = proxyServers
    .sort((a, b) => a.priority - b.priority)
    .find(proxy => proxy.isHealthy);

  console.log('Selected healthy proxy:', healthyProxy?.url || 'none available');
  return healthyProxy?.url || null;
}

// Get proxy configuration by URL or default if not specified
export function getProxyConfig(proxyUrl?: string): ProxyConfig | null {
  if (!proxyUrl) {
    // Get the first healthy proxy by priority
    return proxyServers
      .sort((a, b) => a.priority - b.priority)
      .find(p => p.isHealthy) || null;
  }
  
  const config = proxyServers.find(p => proxyUrl.startsWith(p.url));
  console.log('Found proxy config for URL:', proxyUrl, 'Config:', config);
  return config || getProxyConfig(); // Recursively get default if not found
}

// Transform request based on proxy configuration
export function transformRequest(proxyUrl: string, url: string, options: RequestInit): { url: string; options: RequestInit } {
  const proxyConfig = getProxyConfig(proxyUrl);
  if (proxyConfig?.transformRequest) {
    return proxyConfig.transformRequest(url, options);
  }
  return { url, options };
}

// Get GraphQL endpoint for the given proxy
export function getGraphQLEndpoint(proxyUrl: string): string {
  const proxyConfig = getProxyConfig(proxyUrl);
  if (!proxyConfig) return `${proxyUrl}/gql`;

  if (proxyConfig.url.includes('allorigins')) {
    return proxyConfig.url;
  }
  return `${proxyUrl}/proxy/gql`;
}

// Mark a proxy as unhealthy
export function markProxyUnhealthy(proxyUrl: string): void {
  const proxy = proxyServers.find(p => proxyUrl.startsWith(p.url));
  if (proxy) {
    proxy.isHealthy = false;
    proxy.lastCheck = Date.now();
    console.log('Marked proxy as unhealthy:', proxy.url);
  }
}

// Reset all proxy health statuses
export function resetProxyHealth(): void {
  proxyServers.forEach(proxy => {
    proxy.isHealthy = true;
    proxy.lastCheck = Date.now();
  });
  console.log('Reset all proxy health statuses');
}

// Export the list of proxy servers for testing
export const __TEST_ONLY_proxyServers = proxyServers; 