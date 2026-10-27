import { Seo } from "../../../../../src/index";
import { byline } from "./byline";
import "./Post.css";

export default function Post() {
  return (
    <>
      <Seo title="Hello" description="First post" />
      <main>
        <h1>Hello</h1>
        <p className="post-body">Hello post body</p>
        <p>{byline("ada")}</p>
      </main>
    </>
  );
}
