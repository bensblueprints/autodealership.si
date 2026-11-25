(() => {
  // A tab can outlive the short-lived Clerk JWT. Refresh once and replay reads only.
  let refresh;
  window.readDealerDesk = async (url, options) => {
    const response = await fetch(url, options);
    if (!window.dealerClerkReady) return response;
    const signedOut = url.endsWith("/dealer-auth/me") && response.ok && !(await response.clone().json()).signedIn;
    if (!signedOut && response.status !== 401 && response.status !== 403) return response;
    refresh ??= Promise.resolve(window.dealerClerkReady)
      .then(()=>window.Clerk?.session?.getToken({skipCache:true}))
      .catch(()=>null)
      .finally(()=>{refresh=undefined;});
    return await refresh ? fetch(url, options) : response;
  };
})();
