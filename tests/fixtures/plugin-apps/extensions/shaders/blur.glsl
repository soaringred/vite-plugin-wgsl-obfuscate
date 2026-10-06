// GLSL: never touched by the plugin
uniform float blurRadius;
float blurWeight(float d) { return exp(-d / blurRadius); }
