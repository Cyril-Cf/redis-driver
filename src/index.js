import Redis from "redis-tag-cache";
import { parse } from "node-html-parser";

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

      const cleanedUrl = new URL(route, "http://localhost");
      if (options.paramsToRemoveFromUrl?.length) {
        for (const param of options.paramsToRemoveFromUrl) {
          cleanedUrl.searchParams.delete(param);
        }
      }
      key += `:${cleanedUrl.pathname}${cleanedUrl.search}`;

      const cachedHtml = await client.get(key);
      if (cachedHtml) {
        const protocol =
          context.req.headers["x-forwarded-proto"] ||
          (context.req.connection.encrypted ? "https" : "http");
        const host = context.req.headers["host"];
        const finalOrigin = `${protocol}://${host}`;
        const finalUrl = finalOrigin + reqUrl.pathname + reqUrl.search;
        return rewriteUrlsInHtml(cachedHtml, finalUrl);
      }

      const html = await render();
      const tags = getTags();
      if (tags.length) {
        await client.set(key, html, tags);
      }
      return html;
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
  const root = parse(html);

  const canonical = root.querySelector('link[rel="canonical"]');
  if (canonical) {
    canonical.setAttribute("href", finalUrl);
  }

  const alternates = root.querySelectorAll('link[rel="alternate"]');
  for (const link of alternates) {
    const hreflang = link.getAttribute("hreflang");
    if (hreflang) {
      link.setAttribute("href", finalUrl);
    }
  }

  return root.toString();
}
