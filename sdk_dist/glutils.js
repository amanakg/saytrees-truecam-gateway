var VERTEX_TYPE_HEMISPHERE 	= 0;
var VERTEX_TYPE_PANORAMA	= 1;
var VERTEX_TYPE_CYLINDER   	= 2;
var VERTEX_TYPE_EXPAND		= 3;
var VERTEX_TYPE_NORMAL		= 4;
var VERTEX_TYPE_SPHERE		= 5;
var VERTEX_TYPE_CONE		= 6;

var VERTEX_TYPE_COUNT       = 7;

var TRANSFORM_TYPE_POSITION = 0;
var TRANSFORM_TYPE_SCALE    = 1;
var TRANSFORM_TYPE_ROTATE   = 2;

var SCRN_NORMAL         =	0;
var SCRN_HEMISPHERE     =   1;
var SCRN_CYLINDER       =	2;
var SCRN_EXPAND	        =	3;
var SCRN_UPDOWN	        =	4;
var SCRN_FOUR	        =	5;
    // var SCRN_VR		        =	6;
    // var SCRN_THREE	        =	7;
    // var SCRN_SIX	        =	8;
    // var SCRN_CUP	        =	9;
    // var SCRN_FOUREX         =   10;
    // var SCRN_PANORAMA	    =   11;
    // var SCRN_SPHERE		    =   12;



/////////////////////////////////
// Matrix4 
/////////////////////////////////
function ksTranslate(out,invec3)
{
    out[3*4+0] += (out[0*4+0] * invec3[0] + out[1*4+0] * invec3[1] + out[2*4+0] * invec3[2]);
    out[3*4+1] += (out[0*4+1] * invec3[0] + out[1*4+1] * invec3[1] + out[2*4+1] * invec3[2]);
    out[3*4+2] += (out[0*4+2] * invec3[0] + out[1*4+2] * invec3[1] + out[2*4+2] * invec3[2]);
    out[3*4+3] += (out[0*4+3] * invec3[0] + out[1*4+3] * invec3[1] + out[2*4+3] * invec3[2]);
    return out;
}

function ksRotate(result, angle, x, y, z) {
    var sinAngle, cosAngle;
    var mag = Math.sqrt(x * x + y * y + z * z);

    sinAngle = Math.sin(angle * Math.PI / 180.0);
    cosAngle = Math.cos(angle * Math.PI / 180.0);
    if (mag > 0.0) {
        var xx, yy, zz, xy, yz, zx, xs, ys, zs;
        var oneMinusCos;
        var rotMat = newMat4_identity();

        x /= mag;
        y /= mag;
        z /= mag;

        xx = x * x;
        yy = y * y;
        zz = z * z;
        xy = x * y;
        yz = y * z;
        zx = z * x;
        xs = x * sinAngle;
        ys = y * sinAngle;
        zs = z * sinAngle;
        oneMinusCos = 1.0 - cosAngle;

        rotMat[0*4+0] = (oneMinusCos * xx) + cosAngle;
        rotMat[0*4+1] = (oneMinusCos * xy) - zs;
        rotMat[0*4+2] = (oneMinusCos * zx) + ys;
        rotMat[0*4+3] = 0.0;

        rotMat[1*4+0] = (oneMinusCos * xy) + zs;
        rotMat[1*4+1] = (oneMinusCos * yy) + cosAngle;
        rotMat[1*4+2] = (oneMinusCos * yz) - xs;
        rotMat[1*4+3] = 0.0;

        rotMat[2*4+0] = (oneMinusCos * zx) - ys;
        rotMat[2*4+1] = (oneMinusCos * yz) + xs;
        rotMat[2*4+2] = (oneMinusCos * zz) + cosAngle;
        rotMat[2*4+3] = 0.0;

        rotMat[3*4+0] = 0.0;
        rotMat[3*4+1] = 0.0;
        rotMat[3*4+2] = 0.0;
        rotMat[3*4+3] = 1.0;

        ksMatrixMultiply(result, rotMat, result);
    }
    return result;
}
function ksMatrixMultiply(result, srcA, srcB) {
    var tmp = newMat4_identity();
    var i;

    for (i = 0; i < 4; i++) {
        tmp[i*4+0] = (srcA[i*4+0] * srcB[0*4+0]) +
                (srcA[i*4+1] * srcB[1*4+0]) +
                (srcA[i*4+2] * srcB[2*4+0]) +
                (srcA[i*4+3] * srcB[3*4+0]);

        tmp[i*4+1] = (srcA[i*4+0] * srcB[0*4+1]) +
                (srcA[i*4+1] * srcB[1*4+1]) +
                (srcA[i*4+2] * srcB[2*4+1]) +
                (srcA[i*4+3] * srcB[3*4+1]);

        tmp[i*4+2] = (srcA[i*4+0] * srcB[0*4+2]) +
                (srcA[i*4+1] * srcB[1*4+2]) +
                (srcA[i*4+2] * srcB[2*4+2]) +
                (srcA[i*4+3] * srcB[3*4+2]);

        tmp[i*4+3] = (srcA[i*4+0] * srcB[0*4+3]) +
                (srcA[i*4+1] * srcB[1*4+3]) +
                (srcA[i*4+2] * srcB[2*4+3]) +
                (srcA[i*4+3] * srcB[3*4+3]);
    }
    
    copyMat4(result,tmp);
    return result;
}

function ksFrustum(result, left, right, bottom, top, nearZ, farZ) {
    var deltaX = right - left;
    var deltaY = top - bottom;
    var deltaZ = farZ - nearZ;
    var frust = newMat4_identity();

    if ((nearZ <= 0.0) || (farZ <= 0.0) ||
            (deltaX <= 0.0) || (deltaY <= 0.0) || (deltaZ <= 0.0))
        return;

    frust[0*4+0] = 2.0 * nearZ / deltaX;
    frust[0*4+1] = frust[0*4+2] = frust[0*4+3] = 0.0;

    frust[1*4+1] = 2.0 * nearZ / deltaY;
    frust[1*4+0] = frust[1*4+2] = frust[1*4+3] = 0.0;

    frust[2*4+0] = (right + left) / deltaX;
    frust[2*4+1] = (top + bottom) / deltaY;
    frust[2*4+2] = -(nearZ + farZ) / deltaZ;
    frust[2*4+3] = -1.0;

    frust[3*4+2] = -2.0 * nearZ * farZ / deltaZ;
    frust[3*4+0] = frust[3*4+1] = frust[3*4+3] = 0.0;

    ksMatrixMultiply(result, frust, result);
}

function ksPerspective(result, fovy, aspect, nearZ, farZ) {
    var frustumW, frustumH;
    frustumH = Math.tan(fovy / 360.0 * Math.PI) * nearZ;
    frustumW = frustumH * aspect;

    ksFrustum(result, -frustumW, frustumW, -frustumH, frustumH, nearZ, farZ);
}

function ksOrtho(result, left, right, bottom, top, nearZ, farZ) {
    var deltaX = right - left;
    var deltaY = top - bottom;
    var deltaZ = farZ - nearZ;
    var ortho = newMat4_identity();

    if ((deltaX == 0.0) || (deltaY == 0.0) || (deltaZ == 0.0))
        return;

    ortho[0*4+0] = 2.0 / deltaX;
    ortho[3*4+0] = -(right + left) / deltaX;
    ortho[1*4+1] = 2.0 / deltaY;
    ortho[3*4+1] = -(top + bottom) / deltaY;
    ortho[2*4+2] = -2.0 / deltaZ;
    ortho[3*4+2] = -(nearZ + farZ) / deltaZ;

    ksMatrixMultiply(result, ortho, result);
}

function newMat4_identity()
{
    var out = new Float32Array(16);
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 1;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
}

function copyMat4(out,src)
{
    for(var i=0;i<16;i++)
        out[i] = src[i];
}

/////////////////////////////////////
// * vector 
/////////////////////////////////////    
function vec2(x,y)
{
    var out = new Float32Array(2);
    out[0] = x;
    out[1] = y;
    return out;
}

function vec3(x,y,z)
{
    var out = new Float32Array(3);
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
}

function vec2normalize(out,a)
{
    var x = a[0],
        y = a[1];
    var len = x * x + y * y;
    if (len > 0) {
        //TODO: evaluate use of glm_invsqrt here?
        len = 1 / Math.sqrt(len);
        out[0] = a[0] * len;
        out[1] = a[1] * len;
    }
    return out;
}

function vec3normalize(out,a)
{
    var x = a[0];
    var y = a[1];
    var z = a[2];
    var len = x * x + y * y + z * z;
    if (len > 0) {
        //TODO: evaluate use of glm_invsqrt here?
        len = 1 / Math.sqrt(len);
        out[0] = a[0] * len;
        out[1] = a[1] * len;
        out[2] = a[2] * len;
    }
    return out;
}

function vec2length(a)
{
    var x = a[0],
        y = a[1];
    return Math.sqrt(x * x + y * y);
}

function ksScale(result, sxyz) {
    result[0*4+0] *= sxyz[0];
    result[0*4+1] *= sxyz[0];
    result[0*4+2] *= sxyz[0];
    result[0*4+3] *= sxyz[0];

    result[1*4+0] *= sxyz[1];
    result[1*4+1] *= sxyz[1];
    result[1*4+2] *= sxyz[1];
    result[1*4+3] *= sxyz[1];

    result[2*4+0] *= sxyz[2];
    result[2*4+1] *= sxyz[2];
    result[2*4+2] *= sxyz[2];
    result[2*4+3] *= sxyz[2];
    return result;
}

function cpvec3(src,dst) {
    dst[0] = src[0];
    dst[1] = src[1];
    dst[2] = src[2];
    return dst;
}

function addvec3(src,unit) {
    src[0] += unit[0];
    src[1] += unit[1];
    src[2] += unit[2];
    return src;
}