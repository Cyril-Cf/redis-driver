import Redis from 'redis-tag-cache';

const defaultRedisOptions = {
  maxRetriesPerRequest: 3
};

export default function RedisCache (opt) {
  const options = {
    ...opt,
    redis: {
      ...opt?.redis,
      ...defaultRedisOptions
    }
  };
  const client = new Redis(options);

  return {
    async invoke({ route, context, render, getTags }) {
      let key = 'page';
      if (options.mobileDetectionFn ? options.mobileDetectionFn(context.req) : false) {
        key += ':mobile'
      }

      const baseUrl = 'http://localhost' // necessary to build URL object but unused afterwards
      if (options.paramsToRemoveFromUrl?.length) {
        const url = new URL(route, baseUrl);
        for (const param of options.paramsToRemoveFromUrl) {
          url.searchParams.delete(param);
        }
        key += `:${url.pathname}${url.search}`;
      } else {
        key += `:${route}`;
      }

      const cachedResponse = await client.get(key);
      if (cachedResponse) {
        return cachedResponse;
      }

      const content = await render();
      const tags = getTags();
      if (!tags.length) {
        return content;
      }

      await client.set(
        key,
        content,
        tags
      );
      return content;
    },

    invalidate({ tags }) {
      const clearAll = tags.includes('*');

      if (!clearAll) {
        return client.invalidate(...tags)
      }

      return new Promise((resolve, reject) => {
        client.redis.flushall((err, result) => {
          if (err) {
            return reject(err);
          }
          resolve(result);
        })
      });
    }
  };
};
