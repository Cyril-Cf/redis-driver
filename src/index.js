import Redis from "redis-tag-cache";

const defaultRedisOptions = {
  maxRetriesPerRequest: 3,
};

export default function RedisCache(opt) {
  const options = {
    ...opt,
    redis: {
      ...opt?.redis,
      ...defaultRedisOptions,
    },
  };
  const client = new Redis(options);

  return {
    async invoke({ route, context, render, getTags }) {
      let key = "page";
      const reqUrl = new URL(route, "http://localhost");

      if (options.mobileDetectionFn?.(context.req)) {
        key += ":mobile";
      }

      let forbiddenParamsDetected = false;

      const cleanedUrl = new URL(route, "http://localhost");
      if (options.paramsToRemoveFromUrl?.length) {
        for (const param of options.paramsToRemoveFromUrl) {
          if (cleanedUrl.searchParams.has(param)) {
            forbiddenParamsDetected = true;
          }
          cleanedUrl.searchParams.delete(param);
        }
      }
      key += `:${cleanedUrl.pathname}${cleanedUrl.search}`;
      const protocol =
        context.req.headers["x-forwarded-proto"] ||
        (context.req.connection.encrypted ? "https" : "http");
      const host = context.req.headers["host"];
      const finalOrigin = `${protocol}://${host}`;
      const finalUrl = finalOrigin + reqUrl.pathname + cleanedUrl.search;

      const cachedResponse = await client.get(key);
      if (cachedResponse) {
        return cachedResponse;
      }

      let rendered = await render();
      if (forbiddenParamsDetected) {
        rendered.html = rewriteUrlsInHtml(rendered.html, finalUrl);
      }
      const tags = getTags();
      if (tags.length) {
        await client.set(key, rendered, tags);
      }
      return rendered;
    },

    invalidate({ tags }) {
      const clearAll = tags.includes("*");

      if (!clearAll) {
        return client.invalidate(...tags);
      }

      return new Promise((resolve, reject) => {
        client.redis.flushall((err, result) => {
          if (err) {
            return reject(err);
          }
          resolve(result);
        });
      });
    },
  };
}

function rewriteUrlsInHtml(html, finalUrl) {
  console.log("INSIDE REWRITE");
  html = Buffer.isBuffer(html) ? html.toString("utf8") : String(html);
  html = html.replace(/<link\b([^>]*\brel=["']canonical["'][^>]*)>/i, (m) =>
    m.replace(/href=["'][^"']*["']/, `href="${finalUrl}"`)
  );
  html = html.replace(/<link\b([^>]*\brel=["']alternate["'][^>]*)>/gi, (m) =>
    m.replace(/href=["'][^"']*["']/, `href="${finalUrl}"`)
  );
  return html;
}
