import { defineCollection, z } from "astro:content";

const reference = defineCollection({
  type: "data",
  schema: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        code: z.string().optional(),
        group: z.string().optional(),
        standard: z.string().optional(),
        category: z.string().optional(),
        subcategory: z.string().optional(),
        prefix: z.string().optional(),
        fullName: z.string().optional(),
        text: z.string().optional(),
        ea: z.string().optional(),
        nace: z.string().optional(),
        sampleCount: z.number().optional(),
        scopeCount: z.number().optional(),
        keywords: z.array(z.string()).optional(),
        samples: z.array(z.string()).optional(),
        examples: z.array(z.string()).optional(),
      }),
    ),
  }),
});

export const collections = {
  reference,
};
