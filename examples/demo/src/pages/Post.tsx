import { ContentRegion, ExcludeFromContent, JsonLd, Seo, schema } from "@anubhav-choubey/web-for-agents";
import { useParams } from "react-router";
import { POSTS, SITE_URL } from "../data";
import { NotFound } from "./NotFound";

export default function Post() {
  const { slug } = useParams();
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) return <NotFound />;
  return (
    <>
      <Seo title={post.title} description={`${post.summary} A post from the Paper Lantern Books blog.`} canonical={`/blog/${post.slug}`} type="article" />
      <JsonLd
        data={schema.article({
          headline: post.title,
          description: post.summary,
          datePublished: post.date,
          author: { name: "The Paper Lantern booksellers", url: SITE_URL },
          url: `${SITE_URL}/blog/${post.slug}`,
          image: `${SITE_URL}/og.svg`,
        })}
      />
      <ContentRegion as="article">
        <h1>{post.title}</h1>
        <p>Published {post.date}</p>
        {post.paragraphs.map((t) => (
          <p key={t}>{t}</p>
        ))}
        {/* Left out of the markdown, llms-full.txt and the overlay's markdown view. */}
        <ExcludeFromContent className="promo">
          <strong>Join the Lantern Letter</strong> for a monthly list of new arrivals. Subscribe today.
        </ExcludeFromContent>
      </ContentRegion>
    </>
  );
}
