# Fences hide fake tags

A fenced code block containing convention tags — these must NOT parse (§5.6):

```markdown
<!-- wp:question id="fake1" type="text" -->
**This is documentation, not a real question.**
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
```

Inline code with a fake tag `<!-- wp:question id="fake2" -->` must also be ignored.

But this real question outside any fence must parse normally:

<!-- wp:question id="real" type="text" -->
**A genuine question.**
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
