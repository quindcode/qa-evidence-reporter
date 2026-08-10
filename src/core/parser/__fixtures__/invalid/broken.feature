Given a step without a Feature/Característica header

This file is intentionally invalid Gherkin: a document must start with an
optional "# language:" directive, tags, or a "Feature:" line — never a step
line. Used by gherkinParser.test.ts to verify FeatureParseError handling.
