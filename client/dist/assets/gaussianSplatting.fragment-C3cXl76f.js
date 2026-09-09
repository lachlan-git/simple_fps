import{t as e}from"./shaderStore-D-XQlhUT.js";import{S as t,U as n,W as r,_ as i,r as a,v as o,vt as s,y as c}from"./index-CcnEhoyr.js";var l=`gaussianSplattingPixelShader`,u=`#include<clipPlaneFragmentDeclaration>
#include<logDepthDeclaration>
#include<fogFragmentDeclaration>
#ifdef GPUPICKER_DEPTH
layout(location=0) out highp vec4 glFragData[2];
#endif
#ifdef GPUPICKER_PACK_DEPTH
#include<packingFunctions>
#endif
varying vec4 vColor;varying vec2 vPosition;
#define CUSTOM_FRAGMENT_DEFINITIONS
#include<gaussianSplattingFragmentDeclaration>
void main () {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
vec4 finalColor=gaussianColor(vColor);
#define CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR
#ifdef GPUPICKER_DEPTH
glFragData[0]=finalColor;
#ifdef GPUPICKER_PACK_DEPTH
glFragData[1]=pack(gl_FragCoord.z);
#else
glFragData[1]=vec4(gl_FragCoord.z,0.0,0.0,1.0);
#endif
#else
gl_FragColor=finalColor;
#endif
#define CUSTOM_FRAGMENT_MAIN_END
}
`;e.ShadersStore[l]||(e.ShadersStore[l]=u);var d=[r,t,c,s,o,i,a,n];for(let t of d)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var f={name:l,shader:u};export{f as gaussianSplattingPixelShader};