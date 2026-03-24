# Residential Proxy Manager for Historical Data Fetching

import random
import requests
from typing import Optional, Dict

class ResidentialProxyManager:
    """
    Manages residential proxy rotation for server-side historical data fetching.
    Only used for cold-path data (old reviews), never for real-time analysis.
    """
    
    def __init__(self, proxy_list: Optional[list] = None):
        self.proxy_list = proxy_list or []
        self.current_index = 0
        self.failed_proxies = set()
        
    def get_next_proxy(self) -> Dict[str, str]:
        """Rotate to next available proxy"""
        if not self.proxy_list:
            return {}
            
        attempts = 0
        while attempts < len(self.proxy_list):
            proxy = self.proxy_list[self.current_index]
            self.current_index = (self.current_index + 1) % len(self.proxy_list)
            
            if proxy['host'] not in self.failed_proxies:
                return {
                    'http': f"http://{proxy['user']}:{proxy['pass']}@{proxy['host']}:{proxy['port']}",
                    'https': f"http://{proxy['user']}:{proxy['pass']}@{proxy['host']}:{proxy['port']}"
                }
            attempts += 1
            
        return {}
    
    def mark_failed(self, proxy_host: str):
        """Mark a proxy as failed"""
        self.failed_proxies.add(proxy_host)
        
    async def fetch_with_proxy(self, url: str, headers: Dict) -> Optional[str]:
        """Fetch URL using residential proxy"""
        proxy = self.get_next_proxy()
        if not proxy:
            return None
            
        try:
            response = requests.get(
                url, 
                proxies=proxy, 
                headers=headers, 
                timeout=30,
                verify=False
            )
            response.raise_for_status()
            return response.text
        except Exception as e:
            proxy_host = list(proxy.values())[0].split('@')[-1].split(':')[0]
            self.mark_failed(proxy_host)
            return None
