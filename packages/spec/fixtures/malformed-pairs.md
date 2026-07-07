# Malformed pairs

The parser must degrade to warnings here, never throw.

<!-- wp:question id="dup" type="text" -->
**First question with a duplicated id.**
<!-- wp:answer -->
First answer.
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="dup" type="text" -->
**Second question reusing the same id.**
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

An orphan close tag with no matching open follows:

<!-- /wp:answer -->

<!-- wp:question id="open" type="text" -->
**This question block is never closed.**
<!-- wp:answer -->
A draft that still parses.
<!-- /wp:answer -->
